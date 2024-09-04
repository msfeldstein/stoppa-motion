'use client';

import React, { useState, useRef, useEffect, useCallback, TouchEvent } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import styles from './StopMotionApp.module.css';
import { XCircle, Layers, Mic, Volume2, MicOff, Play, RefreshCw, X } from 'lucide-react'; // Add X icon

const StopMotionApp = () => {
    const [images, setImages] = useState<string[]>([]);
    const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
    const [exporting, setExporting] = useState(false);
    const [onionSkinEnabled, setOnionSkinEnabled] = useState<boolean>(false);
    useEffect(() => {
        setOnionSkinEnabled(JSON.parse(localStorage.getItem('onionSkinEnabled') || 'true'))
    }, [])
    const [listening, setListening] = useState(false);
    useEffect(() => setListening(JSON.parse(localStorage.getItem('listeningEnabled') || 'false')), [])
    const [chimeEnabled, setChimeEnabled] = useState<boolean>(false);
    useEffect(() => {
        JSON.parse(localStorage.getItem('chimeEnabled') || 'true')
    }, [])
    const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const captureCanvasRef = useRef<HTMLCanvasElement>(null);
    const [logs, setLogs] = useState<string[]>([])
    const onionSkinCanvasRef = useRef<HTMLCanvasElement>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
    const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const [projectName, setProjectName] = useState<string>('');
    const [availableProjects, setAvailableProjects] = useState<string[]>([]);
    useEffect(() => setAvailableProjects(JSON.parse(localStorage.getItem('projectList') || '[]')), [])
    const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
    const [currentCameraIndex, setCurrentCameraIndex] = useState(0);

    useEffect(() => {
        // Load FFmpeg
        const loadFFmpeg = async () => {
            const ffmpegInstance = new FFmpeg();
            const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd'
            await ffmpegInstance.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            setFfmpeg(ffmpegInstance);
        };

        loadFFmpeg();

        // Detect available cameras
        const detectCameras = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                console.log("Devices", devices)
                setLogs(logs => [...logs, "Devices" + JSON.stringify(devices)])
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                console.log('Available cameras:', videoDevices);
                setAvailableCameras(videoDevices);
            } catch (error) {
                console.error('Error detecting cameras:', error);
            }
        };

        // Set up camera
        const setupCamera = async () => {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {

                    const constraints = {
                        video: { facingMode: "environment" }
                    };
                    console.log('Attempting to access camera with constraints:', constraints);
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    console.log('Camera stream obtained:', stream);

                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.onloadedmetadata = () => {
                            console.log('Video metadata loaded. Video dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
                        };
                        videoRef.current.onplay = () => {
                            console.log('Video started playing');
                        };
                        videoRef.current.onerror = (e) => {
                            console.error('Video error:', e);
                        };
                        console.log('Camera stream set to video element');
                    } else {
                        console.error('Video ref is null');
                    }
                } catch (err) {
                    console.error("Error accessing the camera:", err);
                    if (err instanceof DOMException) {
                        console.log('DOMException name:', err.name);
                        console.log('DOMException message:', err.message);
                    }
                }
            } else {
                console.error('getUserMedia is not supported in this browser');
            }
        };

        detectCameras().then(() => {
            setupCamera();
        });

        // Check for speech recognition support
        const isSpeechRecognitionSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
        setSpeechRecognitionSupported(isSpeechRecognitionSupported);

        if (isSpeechRecognitionSupported) {
            // Set up speech recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true; // Change back to continuous mode
            recognitionRef.current.interimResults = false; // Disable interim results for more stability

            recognitionRef.current.onresult = (event: any) => {
                const last = event.results.length - 1;
                const transcript = event.results[last][0].transcript.trim().toLowerCase();

                if (transcript.includes('capture')) {
                    captureImage();
                }
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error('Speech recognition error', event.error);
                setListening(false);
                // Attempt to restart recognition after an error
                if (recognitionRef.current) {
                    recognitionRef.current.stop();
                    setTimeout(() => {
                        if (recognitionRef.current) {
                            recognitionRef.current.start();
                            setListening(true);
                        }
                    }, 1000);
                }
            };
        }

        // Initialize AudioContext
        // @ts-ignore
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, [currentCameraIndex]); // Add currentCameraIndex as a dependency

    useEffect(() => {
        // Save project to local storage whenever images change
        if (projectName) {
            localStorage.setItem('currentProjectName', projectName);
            localStorage.setItem(`project_${projectName}`, JSON.stringify(images));
        }
    }, [images, projectName]);

    useEffect(() => {
        localStorage.setItem('onionSkinEnabled', JSON.stringify(onionSkinEnabled));
    }, [onionSkinEnabled]);

    useEffect(() => {
        localStorage.setItem('listeningEnabled', JSON.stringify(listening));
    }, [listening]);

    useEffect(() => {
        localStorage.setItem('chimeEnabled', JSON.stringify(chimeEnabled));
    }, [chimeEnabled]);

    const playChime = useCallback(() => {
        if (audioContextRef.current && chimeEnabled) {
            const oscillator = audioContextRef.current.createOscillator();
            const gainNode = audioContextRef.current.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContextRef.current.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(523.25, audioContextRef.current.currentTime); // C5
            gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.5, audioContextRef.current.currentTime + 0.1);
            gainNode.gain.linearRampToValueAtTime(0, audioContextRef.current.currentTime + 0.5);

            oscillator.start();
            oscillator.stop(audioContextRef.current.currentTime + 0.5);
        }
    }, [chimeEnabled]);

    const updateOnionSkin = useCallback(() => {
        if (onionSkinCanvasRef.current && onionSkinEnabled && images.length > 0) {
            const context = onionSkinCanvasRef.current.getContext('2d');
            if (context) {
                console.log("UPdating onion skin")
                const img = new Image();
                img.onload = () => {
                    context.clearRect(0, 0, 640, 480);
                    context.globalAlpha = 0.3;
                    context.drawImage(img, 0, 0, 640, 480);
                };
                img.src = images[images.length - 1];
            }
        }
    }, [images, onionSkinEnabled]);

    const captureImage = useCallback(() => {
        if (!projectName) {
            alert('Please create or select a project before capturing images.');
            return;
        }
        if (captureCanvasRef.current && videoRef.current) {
            const context = captureCanvasRef.current.getContext('2d');
            if (context) {
                // Set canvas dimensions to match video dimensions
                captureCanvasRef.current.width = videoRef.current.videoWidth;
                captureCanvasRef.current.height = videoRef.current.videoHeight;

                // Capture the current frame
                context.drawImage(videoRef.current, 0, 0, videoRef.current.videoWidth, videoRef.current.videoHeight);
                const imageDataUrl = captureCanvasRef.current.toDataURL('image/jpeg');
                setImages(prevImages => [...prevImages, imageDataUrl]);

                // Update onion skin
                updateOnionSkin();

                // Play chime sound
                playChime();
            }
        }
    }, [images, onionSkinEnabled, playChime, updateOnionSkin, projectName]);

    useEffect(() => {
        updateOnionSkin();
    }, [updateOnionSkin]);

    const handleKeyPress = (event: React.KeyboardEvent) => {
        if (event.code === 'Space') {
            captureImage();
        }
    };

    const handleTouchStart = (index: number, event: TouchEvent) => {
        setDraggedIndex(index);
        setDragOffset(0);
    };

    const handleTouchMove = (event: TouchEvent) => {
        if (draggedIndex !== null) {
            const newOffset = event.touches[0].clientX - event.currentTarget.getBoundingClientRect().left;
            setDragOffset(Math.max(0, newOffset)); // Prevent dragging to the left
        }
    };

    const handleTouchEnd = () => {
        if (draggedIndex !== null) {
            if (dragOffset > 100) { // Threshold to delete
                deleteImage(draggedIndex);
            }
            setDraggedIndex(null);
            setDragOffset(0);
        }
    };

    const toggleListening = () => {
        if (!speechRecognitionSupported) {
            alert('Speech recognition is not supported in your browser.');
            return;
        }

        if (recognitionRef.current) {
            if (listening) {
                recognitionRef.current.stop();
                setListening(false);
            } else {
                recognitionRef.current.start();
                setListening(true);
            }
        }
    };

    const exportVideo = async () => {
        if (!ffmpeg) {
            console.error('FFmpeg not loaded');
            return;
        }

        setExporting(true);

        try {
            // Write images to FFmpeg virtual file system
            for (let i = 0; i < images.length; i++) {
                const imageName = `image${i.toString().padStart(3, '0')}.jpg`;
                await ffmpeg.writeFile(imageName, await fetchFile(images[i]));
            }

            // Run FFmpeg command to create video
            await ffmpeg.exec([
                '-framerate', '5',
                '-i', 'image%03d.jpg',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                'output.mp4'
            ]);

            // Read the output file
            const data = await ffmpeg.readFile('output.mp4');

            // Create a download link
            const blob = new Blob([data], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'stop_motion_video.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting video:', error);
        } finally {
            setExporting(false);
        }
    };

    const deleteImage = useCallback((index: number) => {
        setImages(prevImages => prevImages.filter((_, i) => i !== index));
    }, []);

    const deleteFrame = useCallback((index: number) => {
        setImages(prevImages => prevImages.filter((_, i) => i !== index));
    }, []);

    const stopPreview = () => {
        if (previewIntervalRef.current) {
            clearInterval(previewIntervalRef.current);
        }
        setIsPreviewPlaying(false);

        // Show the camera video and hide the preview canvas
        if (videoRef.current) {
            videoRef.current.style.display = 'block';
        }
        if (onionSkinCanvasRef.current) {
            onionSkinCanvasRef.current.style.display = 'block';
        }
        if (previewCanvasRef.current) {
            previewCanvasRef.current.style.display = 'none';
        }

        // Reset onion skin
        updateOnionSkin();
    };

    const playPreview = () => {
        if (images.length === 0) return;

        setIsPreviewPlaying(true);
        let currentIndex = 0;

        // Hide the camera video and show the preview canvas
        if (videoRef.current) {
            videoRef.current.style.display = 'none';
        }
        if (onionSkinCanvasRef.current) {
            onionSkinCanvasRef.current.style.display = 'none';
        }
        if (previewCanvasRef.current) {
            previewCanvasRef.current.style.display = 'block';
        }

        const playFrame = () => {
            if (previewCanvasRef.current) {
                const context = previewCanvasRef.current.getContext('2d');
                if (context) {
                    const img = new Image();
                    img.onload = () => {
                        context.clearRect(0, 0, 640, 480);
                        context.drawImage(img, 0, 0, 640, 480);
                    };
                    img.src = images[currentIndex];
                }
            }

            currentIndex = (currentIndex + 1) % images.length;

            if (currentIndex === 0) {
                stopPreview();
            }
        };

        previewIntervalRef.current = setInterval(playFrame, 200); // 5 FPS
    };

    const clearOnionSkin = useCallback(() => {
        if (onionSkinCanvasRef.current) {
            const context = onionSkinCanvasRef.current.getContext('2d');
            if (context) {
                context.clearRect(0, 0, 640, 480);
            }
        }
    }, []);

    const startNewProject = () => {
        const newProjectName = prompt('Enter a name for the new project:');
        if (newProjectName && !availableProjects.includes(newProjectName)) {
            setProjectName(newProjectName);
            setImages([]);
            setAvailableProjects(prev => [...prev, newProjectName]);
            localStorage.setItem('projectList', JSON.stringify([...availableProjects, newProjectName]));
            clearOnionSkin(); // Clear the onion skin
        } else if (newProjectName) {
            alert('A project with this name already exists. Please choose a different name.');
        }
    };

    const loadProject = (name: string) => {
        setProjectName(name);
        const loadedImages = JSON.parse(localStorage.getItem(`project_${name}`) || '[]');
        setImages(loadedImages);
        clearOnionSkin(); // Clear the onion skin
        // If there are loaded images, update the onion skin with the last image
        if (loadedImages.length > 0) {
            updateOnionSkin();
        }
    };

    const closeProject = useCallback(() => {
        setProjectName('');
        setImages([]);
        clearOnionSkin(); // Clear the onion skin
    }, [clearOnionSkin]);

    const swapCamera = useCallback(() => {
        setCurrentCameraIndex((prevIndex) => (prevIndex + 1) % availableCameras.length);
    }, [availableCameras]);

    const deleteProject = useCallback((projectName: string) => {
        if (window.confirm(`Are you sure you want to delete the project "${projectName}"?`)) {
            const updatedProjects = availableProjects.filter(p => p !== projectName);
            setAvailableProjects(updatedProjects);
            localStorage.setItem('projectList', JSON.stringify(updatedProjects));
            localStorage.removeItem(`project_${projectName}`);

            if (projectName === projectName) {
                closeProject();
            }
        }
    }, [availableProjects, closeProject]);

    // Add this function to get the first frame of a project
    const getProjectFirstFrame = useCallback((projectName: string) => {
        const projectImages = JSON.parse(localStorage.getItem(`project_${projectName}`) || '[]');
        return projectImages.length > 0 ? projectImages[0] : null;
    }, []);

    const toggleOnionSkin = () => {
        setOnionSkinEnabled(prev => !prev);
    };

    const toggleChime = () => {
        setChimeEnabled(prev => !prev);
    };

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                <div className={styles.cameraContainer}>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline // Add this attribute for iOS
                        className={styles.camera}
                        onLoadedMetadata={() => console.log('Video metadata loaded in JSX')}
                        onPlay={() => console.log('Video started playing in JSX')}
                        onError={(e) => console.error('Video error in JSX:', e)}
                    ></video>
                    <canvas ref={onionSkinCanvasRef} className={styles.onionSkin} width={640} height={480}></canvas>
                    <canvas ref={previewCanvasRef} className={styles.previewCanvas} width={640} height={480} style={{ display: 'none' }}></canvas>
                    <canvas ref={captureCanvasRef} style={{ display: 'none' }}></canvas>
                    <button onClick={captureImage} className={styles.captureButton} aria-label="Capture Frame"></button>
                    {availableCameras.length > 1 && (
                        <button onClick={swapCamera} className={styles.swapCameraButton} aria-label="Swap Camera">
                            <RefreshCw size={24} />
                        </button>
                    )}
                </div>
                <div className={styles.sidePanel}>
                    {projectName ? (
                        <div className={styles.projectInfo}>
                            <h2>{projectName}</h2>
                            <button onClick={closeProject} className={styles.closeProjectButton}>
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className={styles.projectList}>
                            <h2>Projects</h2>
                            {availableProjects.length > 0 ? (
                                <ul>
                                    {availableProjects.map(project => {
                                        const firstFrame = getProjectFirstFrame(project);
                                        return (
                                            <li key={project} className={styles.projectItem}>
                                                <button
                                                    onClick={() => loadProject(project)}
                                                    className={styles.projectButton}
                                                >
                                                    {firstFrame ? (
                                                        <img
                                                            src={firstFrame}
                                                            alt={`First frame of ${project}`}
                                                            className={styles.projectThumbnail}
                                                        />
                                                    ) : (
                                                        <div className={styles.emptyThumbnail} />
                                                    )}
                                                    <span>{project}</span>
                                                    <span
                                                        className={styles.deleteProjectButton}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            deleteProject(project);
                                                        }}
                                                        aria-label={`Delete ${project}`}
                                                    >
                                                        <X size={16} />
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p>No projects available</p>
                            )}
                            <button onClick={startNewProject} className={styles.newProjectButton}>
                                New Project
                            </button>
                        </div>
                    )}
                    {projectName && (
                        <>
                            <div className={styles.gallery}>
                                {images.map((image, index) => (
                                    <div
                                        key={index}
                                        className={`${styles.thumbnailContainer} ${styles.filled}`}
                                        style={{
                                            transform: index === draggedIndex ? `translateX(${dragOffset}px)` : 'none',
                                            opacity: index === draggedIndex ? 1 - (dragOffset / 150) : 1,
                                        }}
                                        onTouchStart={(e) => handleTouchStart(index, e)}
                                        onTouchMove={(e) => handleTouchMove(e)}
                                        onTouchEnd={() => handleTouchEnd()}
                                    >
                                        <img src={image} alt={`Frame ${index + 1}`} className={styles.thumbnail} />
                                        <button
                                            className={styles.deleteFrameButton}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteFrame(index);
                                            }}
                                            aria-label={`Delete frame ${index + 1}`}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className={styles.controls}>
                                <button
                                    onClick={toggleOnionSkin}
                                    className={`${styles.iconButton} ${onionSkinEnabled ? styles.active : ''}`}
                                    aria-label="Toggle Onion Skin"
                                >
                                    <Layers size={24} />
                                </button>
                                <button
                                    onClick={toggleListening}
                                    className={`${styles.iconButton} ${listening ? styles.active : ''}`}
                                    aria-label="Toggle Voice Commands"
                                    title={speechRecognitionSupported ? "Toggle Voice Commands" : "Voice Commands Not Supported"}
                                    disabled={!speechRecognitionSupported}
                                >
                                    {speechRecognitionSupported ? <Mic size={24} /> : <MicOff size={24} />}
                                </button>
                                <button
                                    onClick={toggleChime}
                                    className={`${styles.iconButton} ${chimeEnabled ? styles.active : ''}`}
                                    aria-label="Toggle Chime Sound"
                                >
                                    <Volume2 size={24} />
                                </button>
                                <button
                                    onClick={playPreview}
                                    className={`${styles.iconButton} ${isPreviewPlaying ? styles.active : ''}`}
                                    aria-label="Preview Animation"
                                    disabled={isPreviewPlaying || images.length === 0}
                                >
                                    <Play size={24} />
                                </button>
                            </div>
                            <button onClick={exportVideo} className={styles.exportButton} disabled={exporting || images.length === 0}>
                                {exporting ? 'Exporting...' : 'Export Video'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StopMotionApp;