
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

import { Badge, IconButton, TextField, Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import ChatIcon from '@mui/icons-material/Chat';

import styles from '../styles/videoComponent.module.css';
import server from '../environment';

const server_url = server;

const connections = {};

const peerConfigConnections = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

export default function VideoMeetComponent() {
    const navigate = useNavigate();

    const socketRef = useRef(null);
    const socketIdRef = useRef(null);
    const localVideoref = useRef(null);
    const videoRef = useRef([]);

    const [videoAvailable, setVideoAvailable] = useState(true);
    const [audioAvailable, setAudioAvailable] = useState(true);

    const [video, setVideo] = useState(true);
    const [audio, setAudio] = useState(true);
    const [screen, setScreen] = useState(false);

    const [showModal, setModal] = useState(false);
    const [screenAvailable, setScreenAvailable] = useState(false);

    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState('');
    const [newMessages, setNewMessages] = useState(0);

    const [askForUsername, setAskForUsername] = useState(true);
    const [username, setUsername] = useState('');
    const [videos, setVideos] = useState([]);

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((previousMessages) => [
            ...previousMessages,
            { sender, data }
        ]);

        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((previousCount) => previousCount + 1);
        }
    };

    const getPermissions = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();

            setVideoAvailable(
                devices.some((device) => device.kind === 'videoinput')
            );
            setAudioAvailable(
                devices.some((device) => device.kind === 'audioinput')
            );
            setScreenAvailable(
                Boolean(navigator.mediaDevices.getDisplayMedia)
            );
        } catch (error) {
            console.error('Could not check media devices:', error);
        }
    };

    useEffect(() => {
        getPermissions();

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }

            Object.keys(connections).forEach((id) => {
                connections[id]?.close();
                delete connections[id];
            });

            if (window.localStream) {
                window.localStream.getTracks().forEach((track) => {
                    track.stop();
                });
                window.localStream = null;
            }
        };
    }, []);

    const getUserMediaSuccess = (stream) => {
        if (window.localStream) {
            window.localStream.getTracks().forEach((track) => track.stop());
        }

        window.localStream = stream;

        if (localVideoref.current) {
            localVideoref.current.srcObject = stream;
        }

        Object.keys(connections).forEach((id) => {
            if (id === socketIdRef.current) return;

            const peer = connections[id];
            if (!peer) return;

            stream.getTracks().forEach((track) => {
                peer.addTrack(track, stream);
            });

            peer.createOffer()
                .then((description) => peer.setLocalDescription(description))
                .then(() => {
                    socketRef.current?.emit(
                        'signal',
                        id,
                        JSON.stringify({ sdp: peer.localDescription })
                    );
                })
                .catch(console.error);
        });
    };

    const getUserMedia = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: Boolean(video && videoAvailable),
                audio: Boolean(audio && audioAvailable)
            });

            getUserMediaSuccess(stream);
        } catch (error) {
            console.error('Could not access camera/microphone:', error);
        }
    };

    const getDisplayMediaSuccess = (stream) => {
        if (window.localStream) {
            window.localStream.getTracks().forEach((track) => track.stop());
        }

        window.localStream = stream;

        if (localVideoref.current) {
            localVideoref.current.srcObject = stream;
        }

        stream.getVideoTracks().forEach((track) => {
            track.onended = () => {
                setScreen(false);
                getUserMedia();
            };
        });
    };

    const getDisplayMedia = async () => {
        try {
            if (!navigator.mediaDevices.getDisplayMedia) {
                return;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            getDisplayMediaSuccess(stream);
        } catch (error) {
            console.error('Could not share screen:', error);
            setScreen(false);
        }
    };

    useEffect(() => {
        if (!askForUsername && (video || audio)) {
            getUserMedia();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video, audio, askForUsername]);

    useEffect(() => {
        if (!askForUsername && screen) {
            getDisplayMedia();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen, askForUsername]);

    const gotMessageFromServer = (fromId, messageData) => {
        try {
            const signal = JSON.parse(messageData);
            const peer = connections[fromId];

            if (!peer || fromId === socketIdRef.current) return;

            if (signal.sdp) {
                peer.setRemoteDescription(
                    new RTCSessionDescription(signal.sdp)
                ).then(async () => {
                    if (signal.sdp.type === 'offer') {
                        const answer = await peer.createAnswer();
                        await peer.setLocalDescription(answer);

                        socketRef.current?.emit(
                            'signal',
                            fromId,
                            JSON.stringify({ sdp: peer.localDescription })
                        );
                    }
                }).catch(console.error);
            }

            if (signal.ice) {
                peer.addIceCandidate(
                    new RTCIceCandidate(signal.ice)
                ).catch(console.error);
            }
        } catch (error) {
            console.error('Could not process call signal:', error);
        }
    };

    const connectToSocketServer = () => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(server_url);

        socketRef.current.on('signal', gotMessageFromServer);

        socketRef.current.on('connect', () => {
            socketIdRef.current = socketRef.current.id;

            socketRef.current.emit('join-call', window.location.href);
            socketRef.current.on('chat-message', addMessage);

            socketRef.current.on('user-left', (id) => {
                if (connections[id]) {
                    connections[id].close();
                    delete connections[id];
                }

                setVideos((previousVideos) => {
                    const updatedVideos = previousVideos.filter(
                        (item) => item.socketId !== id
                    );
                    videoRef.current = updatedVideos;
                    return updatedVideos;
                });
            });

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {
                    if (socketListId === socketIdRef.current) return;

                    if (!connections[socketListId]) {
                        const peer = new RTCPeerConnection(
                            peerConfigConnections
                        );

                        connections[socketListId] = peer;

                        peer.onicecandidate = (event) => {
                            if (event.candidate) {
                                socketRef.current?.emit(
                                    'signal',
                                    socketListId,
                                    JSON.stringify({ ice: event.candidate })
                                );
                            }
                        };

                        peer.ontrack = (event) => {
                            const remoteStream = event.streams[0];
                            if (!remoteStream) return;

                            setVideos((previousVideos) => {
                                const exists = previousVideos.some(
                                    (item) => item.socketId === socketListId
                                );

                                const updatedVideos = exists
                                    ? previousVideos.map((item) =>
                                        item.socketId === socketListId
                                            ? { ...item, stream: remoteStream }
                                            : item
                                    )
                                    : [
                                        ...previousVideos,
                                        {
                                            socketId: socketListId,
                                            stream: remoteStream
                                        }
                                    ];

                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        };

                        if (window.localStream) {
                            window.localStream.getTracks().forEach((track) => {
                                peer.addTrack(track, window.localStream);
                            });
                        }

                        if (socketIdRef.current === id) {
                            peer.createOffer()
                                .then((description) =>
                                    peer.setLocalDescription(description)
                                )
                                .then(() => {
                                    socketRef.current?.emit(
                                        'signal',
                                        socketListId,
                                        JSON.stringify({
                                            sdp: peer.localDescription
                                        })
                                    );
                                })
                                .catch(console.error);
                        }
                    }
                });
            });
        });
    };

    const getMedia = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: Boolean(video && videoAvailable),
                audio: Boolean(audio && audioAvailable)
            });

            getUserMediaSuccess(stream);
        } catch (error) {
            console.error('Could not start camera/microphone:', error);
        }

        connectToSocketServer();
    };

    const connect = () => {
        if (!username.trim()) {
            alert('Please enter your username.');
            return;
        }

        setAskForUsername(false);
        getMedia();
    };

    const handleVideo = () => {
        setVideo((previous) => !previous);
    };

    const handleAudio = () => {
        setAudio((previous) => !previous);
    };

    const handleScreen = () => {
        setScreen((previous) => !previous);
    };

    const handleEndCall = () => {
        if (window.localStream) {
            window.localStream.getTracks().forEach((track) => track.stop());
            window.localStream = null;
        }

        Object.keys(connections).forEach((id) => {
            connections[id]?.close();
            delete connections[id];
        });

        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }

        setVideos([]);
        videoRef.current = [];

        navigate('/home', { replace: true });
    };

    const openChat = () => {
        setModal(true);
        setNewMessages(0);
    };

    const handleMessage = (event) => {
        setMessage(event.target.value);
    };

    const sendMessage = () => {
        if (!message.trim() || !socketRef.current) return;

        socketRef.current.emit('chat-message', message, username);
        setMessage('');
    };

    return (
        <div>
            {askForUsername ? (
                <div>
                    <h2>Enter into Lobby</h2>

                    <TextField
                        label="Username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        variant="outlined"
                    />

                    <Button variant="contained" onClick={connect}>
                        Connect
                    </Button>

                    <div>
                        <video ref={localVideoref} autoPlay muted playsInline />
                    </div>
                </div>
            ) : (
                <div className={styles.meetVideoContainer}>
                    {showModal && (
                        <div className={styles.chatRoom}>
                            <div className={styles.chatContainer}>
                                <h1>Chat</h1>

                                <div className={styles.chattingDisplay}>
                                    {messages.length > 0 ? (
                                        messages.map((item, index) => (
                                            <div
                                                style={{ marginBottom: '20px' }}
                                                key={index}
                                            >
                                                <p style={{ fontWeight: 'bold' }}>
                                                    {item.sender}
                                                </p>
                                                <p>{item.data}</p>
                                            </div>
                                        ))
                                    ) : (
                                        <p>No Messages Yet</p>
                                    )}
                                </div>

                                <div className={styles.chattingArea}>
                                    <TextField
                                        value={message}
                                        onChange={handleMessage}
                                        label="Enter Your chat"
                                        variant="outlined"
                                    />

                                    <Button variant="contained" onClick={sendMessage}>
                                        Send
                                    </Button>

                                    <Button onClick={() => setModal(false)}>
                                        Close
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: 'white' }}>
                            {video ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>

                        <IconButton onClick={handleEndCall} style={{ color: 'red' }}>
                            <CallEndIcon />
                        </IconButton>

                        <IconButton onClick={handleAudio} style={{ color: 'white' }}>
                            {audio ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable && (
                            <IconButton onClick={handleScreen} style={{ color: 'white' }}>
                                {screen ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton>
                        )}

                        <Badge badgeContent={newMessages} max={999} color="warning">
                            <IconButton
                                onClick={openChat}
                                style={{ color: 'white' }}
                            >
                                <ChatIcon />
                            </IconButton>
                        </Badge>
                    </div>

                    <video
                        className={styles.meetUserVideo}
                        ref={localVideoref}
                        autoPlay
                        muted
                        playsInline
                    />

                    <div className={styles.conferenceView}>
                        {videos.map((item) => (
                            <div key={item.socketId}>
                                <video
                                    data-socket={item.socketId}
                                    ref={(ref) => {
                                        if (ref && item.stream) {
                                            ref.srcObject = item.stream;
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
