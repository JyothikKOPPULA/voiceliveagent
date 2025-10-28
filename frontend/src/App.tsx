import React, { useState, useRef, useEffect } from 'react';
import './App.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isRecent?: boolean; // Mark recent messages
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]); // Only last few messages
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [avatarConnected, setAvatarConnected] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarIceServers, setAvatarIceServers] = useState<RTCIceServer[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('');
  const [showFullHistory, setShowFullHistory] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, recentMessages]);

  // Keep only recent messages (last 4 exchanges)
  useEffect(() => {
    const maxRecentMessages = 8; // 4 user + 4 assistant messages
    setRecentMessages(messages.slice(-maxRecentMessages));
  }, [messages]);

  // Auto-cleanup old messages every 10 minutes (optional)
  useEffect(() => {
    const autoCleanup = setInterval(() => {
      if (messages.length > 20) {
        console.log('🧹 Auto-cleaning old messages to improve performance');
        setMessages(prev => prev.slice(-12)); // Keep only last 12 messages
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(autoCleanup);
  }, [messages.length]);

  const startSession = async () => {
    try {
      const response = await fetch('/api/session', { method: 'POST' });
      const data = await response.json();
      setSessionId(data.session_id);

      // Connect WebSocket
      const websocket = new WebSocket(`ws://localhost:3000/api/ws/${data.session_id}`);
      
      websocket.onopen = () => {
        setIsConnected(true);
        setWs(websocket);
        console.log('WebSocket connected');
      };

      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      };

      websocket.onclose = () => {
        setIsConnected(false);
        setWs(null);
        console.log('WebSocket disconnected');
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'user_transcript_completed':
        // User finished speaking
        addMessage('user', message.transcript);
        console.log('User said:', message.transcript);
        // Clear any previous assistant streaming message when user speaks
        setCurrentAssistantMessage('');
        break;
        
      case 'assistant_transcript_delta':
        // Real-time streaming of assistant's speech - accumulate for current response
        setCurrentAssistantMessage(prev => {
          // If this is the first delta of a new response, start fresh
          if (prev === '' || message.delta === prev) {
            return message.delta || '';
          }
          return prev + (message.delta || '');
        });
        break;
        
      case 'assistant_transcript_done':
        // Assistant finished speaking - use final transcript and clear streaming
        const finalTranscript = message.transcript || currentAssistantMessage;
        if (finalTranscript) {
          addMessage('assistant', finalTranscript);
        }
        setCurrentAssistantMessage(''); // Clear streaming message
        console.log('Assistant said:', finalTranscript);
        break;
        
      case 'response.audio.delta':
      case 'assistant_audio_delta':
        // Avatar audio response started - clear previous streaming text
        break;
        
      case 'speech_started':
        // User started speaking - clear any assistant streaming
        setCurrentAssistantMessage('');
        break;
        
      case 'response_done':
        // Response completely finished - ensure streaming is cleared
        setCurrentAssistantMessage('');
        break;
        
      case 'avatar_connecting':
        console.log('Avatar connecting...');
        setAvatarLoading(true);
        break;
      case 'avatar_connected':
        console.log('Avatar connected!');
        setAvatarLoading(false);
        break;
      case 'avatar_disconnected':
        console.log('Avatar disconnected by server');
        setAvatarConnected(false);
        setAvatarLoading(false);
        if (peerConnection) {
          peerConnection.close();
          setPeerConnection(null);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        break;
      case 'event': {
        const payload = message.payload as Record<string, any> | undefined;
        if (payload?.type === "session.updated") {
          console.log('Received session.updated:', payload);
          const session = payload.session ?? {};
          const avatar = session.avatar ?? {};
          
          // Look for ICE servers in multiple locations
          const candidateSources = [
            avatar.ice_servers,
            session.rtc?.ice_servers,
            session.ice_servers,
          ].find((value) => Array.isArray(value));
          
          if (candidateSources) {
            const normalized: RTCIceServer[] = candidateSources
              .map((entry: any) => {
                if (typeof entry === "string") {
                  return { urls: entry } as RTCIceServer;
                }
                if (entry && typeof entry === "object") {
                  const { urls, username, credential } = entry;
                  if (!urls) {
                    return null;
                  }
                  return {
                    urls,
                    username,
                    credential,
                  } as RTCIceServer;
                }
                return null;
              })
              .filter((entry): entry is RTCIceServer => Boolean(entry));
            
            if (normalized.length) {
              setAvatarIceServers(normalized);
              console.log(`Received ${normalized.length} ICE server${normalized.length > 1 ? "s" : ""} from session:`, normalized);
            }
          }
        }
        break;
      }
      case 'error':
        console.error('Voice Live error:', message.payload);
        break;
      default:
        console.log('Received message:', message);
    }
  };

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      isRecent: true
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const clearConversationHistory = () => {
    setMessages([]);
    setRecentMessages([]);
    setCurrentAssistantMessage(''); // Clear any streaming assistant message
    console.log('🧹 Conversation history cleared');
  };

  const disconnectAvatar = async () => {
    if (!sessionId || !avatarConnected) return;

    try {
      // Close WebRTC connection
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }

      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // Remove audio element
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }

      // Call backend to disconnect avatar
      const response = await fetch(`/api/session/${sessionId}/avatar/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Backend avatar disconnect failed:', errorData);
      }

      setAvatarConnected(false);
      setAvatarLoading(false);
      console.log('Avatar disconnected');

    } catch (error) {
      console.error('Failed to disconnect avatar:', error);
      // Still set state to disconnected even if backend call fails
      setAvatarConnected(false);
      setAvatarLoading(false);
      setPeerConnection(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    }
  };

  const connectAvatar = async () => {
    if (!sessionId || avatarConnected || avatarLoading) return;

    setAvatarLoading(true);
    console.log('Starting avatar connection...');

    try {
      // Create RTCPeerConnection with ICE servers from Azure
      const pc = new RTCPeerConnection({
        bundlePolicy: "max-bundle",
        iceServers: avatarIceServers.length > 0 ? avatarIceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      
      console.log('Created RTCPeerConnection with ICE servers:', pc.getConfiguration().iceServers);

      // Add receive-only transceivers for avatar stream
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });
      console.log('Added audio and video transceivers');

      // Handle incoming tracks
      pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind, 'streams:', event.streams.length);
        const [stream] = event.streams;
        if (!stream) {
          console.warn('No stream received with track');
          return;
        }

        if (event.track.kind === "video" && videoRef.current) {
          console.log('Setting video srcObject');
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => {
            console.log('Video playing successfully');
            setAvatarConnected(true);
            setAvatarLoading(false);
          }).catch((err) => {
            console.error('Failed to play video:', err);
          });
        }

        if (event.track.kind === "audio") {
          console.log('Setting up audio track');
          // Create hidden audio element for WebRTC audio
          let audioEl = remoteAudioRef.current;
          if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            audioEl.controls = false;
            audioEl.style.display = "none";
            audioEl.setAttribute("playsinline", "true");
            audioEl.muted = false;
            document.body.appendChild(audioEl);
            remoteAudioRef.current = audioEl;
          }
          audioEl.srcObject = stream;
          audioEl.play().catch((err) => console.warn('Audio autoplay failed:', err));
          console.log('Avatar audio track configured');
        }
      };

      // Monitor connection states
      pc.onconnectionstatechange = () => {
        console.log('WebRTC connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          console.error('WebRTC connection failed');
          setAvatarLoading(false);
          setAvatarConnected(false);
        }
        if (pc.connectionState === 'disconnected') {
          console.log('WebRTC disconnected');
          setAvatarConnected(false);
          setPeerConnection(null);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          console.error('ICE connection failed - check network/TURN servers');
        }
      };

      // Wait for ICE gathering to complete
      const gatheringFinished = new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") {
              resolve();
            }
          });
        }
      });

      // Create and set local description
      console.log('Creating SDP offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatheringFinished;

      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("Failed to obtain local SDP");
      }

      console.log('Sending SDP offer to backend, SDP length:', localSdp.length);
      
      // Send SDP offer to backend using the correct endpoint
      const response = await fetch(`/api/session/${sessionId}/avatar/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_sdp: localSdp }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Avatar offer failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Received SDP answer from backend, length:', data.server_sdp?.length);

      // Set remote description with Azure's SDP answer
      await pc.setRemoteDescription({ type: "answer", sdp: data.server_sdp });
      console.log('Set remote description successfully');

      setPeerConnection(pc);
      console.log('Avatar SDP negotiation completed');

    } catch (error) {
      console.error('Failed to connect avatar:', error);
      setAvatarLoading(false);
      setAvatarConnected(false);
      alert(`Failed to connect avatar: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const startRecording = async () => {
    try {
      console.log('Starting microphone with PCM audio...');
      
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      // Create AudioContext for PCM processing
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Process audio and send PCM chunks
      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array (PCM 16-bit)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const bytes = new Uint8Array(pcmData.buffer);
        const base64 = btoa(String.fromCharCode(...bytes));

        // Send PCM audio chunk
        ws.send(JSON.stringify({
          type: 'audio_chunk',
          audio: base64
        }));
      };

      // Store all references for cleanup
      setMediaRecorder({ 
        stop: () => {
          console.log('Stopping audio processing...');
          try {
            processor.onaudioprocess = null;
            processor.disconnect();
            source.disconnect();
            stream.getTracks().forEach(track => {
              track.stop();
              console.log('Stopped track:', track.kind);
            });
            audioContext.close().then(() => {
              console.log('AudioContext closed');
            });
          } catch (err) {
            console.error('Error during cleanup:', err);
          }
        },
        stream: stream,
        audioContext: audioContext,
        processor: processor,
        source: source
      } as any);
      
      setIsRecording(true);
      console.log('✅ PCM audio streaming started');

    } catch (error) {
      console.error('Failed to start recording:', error);
      alert(`Microphone error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const stopRecording = () => {
    console.log('Stop recording called');
    if (mediaRecorder) {
      try {
        // Call the stop function we defined
        mediaRecorder.stop();
        
        // Commit audio buffer to Azure
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'commit_audio' }));
          console.log('Committed audio buffer');
        }
        
        // Clear the recorder reference
        setMediaRecorder(null);
        setIsRecording(false);
        console.log('✅ Recording stopped');
        
      } catch (error) {
        console.error('Error stopping recording:', error);
        setMediaRecorder(null);
        setIsRecording(false);
      }
    }
  };

  const sendTextMessage = async (text: string) => {
    if (!sessionId || !text.trim()) return;

    try {
      await fetch(`/api/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get('message') as string;
    if (text) {
      sendTextMessage(text);
      e.currentTarget.reset();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎙️ Contact Center </h1>
        <div className="header-controls">
          <div className="status">
            Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
            {isConnected && (
              <span> | Avatar: {avatarConnected ? '👤 Connected' : '👻 Disconnected'}</span>
            )}
          </div>
          <div className="header-buttons">
            {isConnected && messages.length > 0 && (
              <button onClick={clearConversationHistory} className="btn-clear" title="Clear conversation history">
                🧹 Clear
              </button>
            )}
            {!isConnected ? (
              <button onClick={startSession} className="btn-primary">
                Start Session
              </button>
            ) : avatarLoading ? (
              <button disabled className="btn-secondary">
                Connecting Avatar...
              </button>
            ) : avatarConnected ? (
              <button onClick={disconnectAvatar} className="btn-secondary">
                Disconnect Avatar
              </button>
            ) : (
              <button onClick={connectAvatar} className="btn-secondary">
                Connect Avatar
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Top Section: User, User Transcription, Avatar Transcription, Avatar */}
        <div className="top-section">
          <div className="participant-container">
            {/* User Box */}
            <div className="user-video-box">
              <div className="box-label">User</div>
              <div className="user-profile-circle">
                <svg viewBox="0 0 100 100" className="user-icon-svg">
                  <circle cx="50" cy="50" r="50" fill="#7B9AB8"/>
                  <circle cx="50" cy="35" r="18" fill="#5A7A98"/>
                  <path d="M 15 85 Q 15 60 50 60 Q 85 60 85 85 Z" fill="#5A7A98"/>
                </svg>
              </div>
            </div>

            {/* User Transcription - Show only most recent */}
            <div className="transcription-box user-transcription">
              <div className="transcription-header">
                <span className="transcription-icon">👤</span>
                <span className="transcription-title">User</span>
              </div>
              <div className="transcription-content">
                {(() => {
                  const lastUserMessage = recentMessages
                    .filter(m => m.role === 'user')
                    .slice(-1)[0];
                  
                  return lastUserMessage ? (
                    <div key={lastUserMessage.id} className="transcript-text">
                      {lastUserMessage.content}
                      <div className="transcript-timestamp">
                        {lastUserMessage.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  ) : (
                    <div className="transcript-placeholder">Start talking...</div>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="participant-container">
            {/* Avatar Transcription - Show only most recent response */}
            <div className="transcription-box avatar-transcription">
              <div className="transcription-header">
                <span className="transcription-icon">🤖</span>
                <span className="transcription-title">Avatar</span>
                {currentAssistantMessage && (
                  <span className="speaking-indicator">🔊</span>
                )}
              </div>
              <div className="transcription-content">
                {currentAssistantMessage ? (
                  <div className="transcript-text streaming">
                    {currentAssistantMessage}
                    <span className="cursor">|</span>
                  </div>
                ) : (
                  // Show only the VERY LAST assistant message
                  (() => {
                    const lastAssistantMessage = recentMessages
                      .filter(m => m.role === 'assistant')
                      .slice(-1)[0];
                    
                    return lastAssistantMessage ? (
                      <div key={lastAssistantMessage.id} className="transcript-text">
                        {lastAssistantMessage.content}
                        <div className="transcript-timestamp">
                          {lastAssistantMessage.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    ) : (
                      <div className="transcript-placeholder">Waiting for response...</div>
                    );
                  })()
                )}
              </div>
            </div>

            {/* Avatar Video Box */}
            <div className="avatar-video-box">
              <div className="box-label">Avatar</div>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted={false}
                controls={false}
                className="avatar-video-small"
              />
              {!avatarConnected && !avatarLoading && (
                <div className="video-placeholder">
                  <div className="avatar-icon-large">
                    <svg viewBox="0 0 100 100" className="avatar-icon-svg">
                      <circle cx="50" cy="50" r="50" fill="#7B8A9E"/>
                      <circle cx="50" cy="35" r="18" fill="#5A6A7E"/>
                      <path d="M 15 85 Q 15 60 50 60 Q 85 60 85 85 Z" fill="#5A6A7E"/>
                    </svg>
                  </div>
                </div>
              )}
              {avatarLoading && (
                <div className="video-loading">
                  <div>⏳</div>
                  <div>Connecting...</div>
                </div>
              )}
            </div>
          </div>
        </div>

          {/* Chat History Section - Show Recent Only */}
          <div className="chat-section">
            <div className="chat-header">
              <span className="chat-icon">💬</span>
              <span className="chat-title">Recent Conversation</span>
              <div className="chat-controls">
                <button 
                  onClick={() => setShowFullHistory(!showFullHistory)} 
                  className="btn-toggle"
                  title={showFullHistory ? "Show recent only" : "Show full history"}
                >
                  {showFullHistory ? '📋 Recent' : '📜 Full'}
                </button>
                {messages.length > 8 && (
                  <span className="message-count">
                    {showFullHistory ? messages.length : recentMessages.length} messages
                  </span>
                )}
              </div>
            </div>
            <div className="chat-messages">
              {(showFullHistory ? messages : recentMessages).map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <div className="message-header">
                    <span className="role">
                      {message.role === 'user' ? '👤 You' : '🤖 Assistant'}
                    </span>
                    <span className="timestamp">
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="message-content">{message.content}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

          <div className="input-section">
            <div className="voice-controls">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isConnected}
                className={`btn-voice ${isRecording ? 'recording' : ''}`}
              >
                {isRecording ? '⏹️ Stop' : '🎤 Talk'}
              </button>
            </div>

            <form onSubmit={handleTextSubmit} className="text-input">
              <input
                type="text"
                name="message"
                placeholder="Type a message..."
                disabled={!isConnected}
                className="text-input-field"
              />
              <button type="submit" disabled={!isConnected} className="btn-send">
                Send
              </button>
            </form>
          </div>
          </div>
      </main>
    </div>
  );
};

export default App;