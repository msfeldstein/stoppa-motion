'use client';

import React, { useState, useRef, useEffect, useCallback, TouchEvent } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import styles from './StopMotionApp.module.css';
import { XCircle, Layers, Mic, Volume2, MicOff, Play } from 'lucide-react'; // Add Play icon

const StopMotionApp = () => {
    const [images, setImages] = useState<string[]>([]);
    const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
    const [exporting, setExporting] = useState(false);
    const [onionSkinEnabled, setOnionSkinEnabled] = useState(true);
    const [listening, setListening] = useState(false);
    const [chimeEnabled, setChimeEnabled] = useState(true);
    const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const captureCanvasRef = useRef<HTMLCanvasElement>(null);
    const onionSkinCanvasRef = useRef<HTMLCanvasElement>(null);
    // @ts-ignore
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
    const previewIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

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

        // Set up camera
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                })
                .catch(err => console.error("Error accessing the camera:", err));
        }

        // Check for speech recognition support
        const isSpeechRecognitionSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
        setSpeechRecognitionSupported(isSpeechRecognitionSupported);

        if (isSpeechRecognitionSupported) {
            // Set up speech recognition
            // @ts-ignore
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
    }, []);

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
                context.clearRect(0, 0, 640, 480);
                const img = new Image();
                img.onload = () => {
                    context.globalAlpha = 0.3;
                    context.drawImage(img, 0, 0, 640, 480);
                };
                img.src = images[images.length - 1];
            }
        }
    }, [images, onionSkinEnabled]);

    const captureImage = useCallback(() => {
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
    }, [images, onionSkinEnabled, playChime, updateOnionSkin]);

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

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                <div className={styles.cameraContainer}>
                    <video ref={videoRef} autoPlay className={styles.camera}></video>
                    <canvas ref={onionSkinCanvasRef} className={styles.onionSkin} width={640} height={480}></canvas>
                    <canvas ref={previewCanvasRef} className={styles.previewCanvas} width={640} height={480} style={{ display: 'none' }}></canvas>
                    <canvas ref={captureCanvasRef} style={{ display: 'none' }}></canvas>
                    <button onClick={captureImage} className={styles.captureButton} aria-label="Capture Frame"></button>
                </div>
                <div className={styles.sidePanel}>
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
                            </div>
                        ))}
                    </div>
                    <div className={styles.controls}>
                        <button
                            onClick={() => setOnionSkinEnabled(!onionSkinEnabled)}
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
                            onClick={() => setChimeEnabled(!chimeEnabled)}
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
                </div>
            </div>
            {listening && speechRecognitionSupported && <span className={styles.voiceHint}>Say &quot;capture&quot; to take a photo</span>}
        </div>
    );
};

export default StopMotionApp;