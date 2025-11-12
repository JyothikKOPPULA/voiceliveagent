import React, { useState, useRef, useEffect } from 'react';
import './App.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isRecent?: boolean; // Mark recent messages
}

interface Config {
  model: string;
  agent_name: string;
  instructions: string;
  agent_id: string;
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
  // Removed unused setShowFullHistory to fix warning
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [config, setConfig] = useState<Config>({
    model: 'gpt-4o-mini',
    agent_name: 'voice-agent',
    instructions: 'You are an AI Voice Assistant designed to have natural conversations with users. You should respond in a friendly, helpful manner and provide accurate information. When users greet you, respond warmly and ask how you can help them today. Keep your responses conversational and engaging.',
    agent_id: ''
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [agentStatus, setAgentStatus] = useState({ has_agent: false, ready_for_session: false });

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

  // Load initial configuration from backend - only when starting session
  const loadConfig = async () => {
    if (configLoaded) return; // Don't reload if already loaded
    
    try {
      // Load config and status in parallel
      const [configResponse, statusResponse] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/config/status')
      ]);
      
      if (configResponse.ok) {
        const backendConfig = await configResponse.json();
        setConfig({
          model: backendConfig.model || 'gpt-4o-mini',
          agent_name: backendConfig.agent_name || 'voice-agent',
          instructions: backendConfig.instructions || 'You are an AI Voice Assistant designed to have natural conversations with users.',
          agent_id: backendConfig.agent_id || ''
        });
      }
      
      if (statusResponse.ok) {
        const status = await statusResponse.json();
        setAgentStatus(status);
      }
      
      setConfigLoaded(true);
    } catch (error) {
      console.error('Failed to load config:', error);
      setConfigLoaded(true); // Mark as loaded even if failed to avoid retry loops
    }
  };

  // Update configuration locally only (for real-time typing)
  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
  };

  const startSession = async () => {
    try {
      // Load configuration only when starting session
      await loadConfig();
      
      // Check if agent is configured
      if (!config.agent_id) {
        alert('Please create an agent first by configuring and saving your agent settings.');
        return;
      }
      
      const response = await fetch('/api/session', { method: 'POST' });
      const data = await response.json();
      setSessionId(data.session_id);

      // Connect WebSocket - use proxy on port 3000 which forwards to backend on port 8000
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

  const saveConfiguration = async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          agent_name: config.agent_name,
          instructions: config.instructions
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Agent configuration result:', result);
        
        // Update config with the agent ID
        setConfig(prev => ({ ...prev, agent_id: result.agent_id }));
        
        // Update agent status
        setAgentStatus({ has_agent: true, ready_for_session: true });
        
        alert(result.message);
      } else {
        const error = await response.json();
        throw new Error(error.detail || `HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <>
      <style>{`
        html, body, #root {
          background: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
          min-height: 100vh !important;
          height: 100% !important;
          overflow-x: hidden !important;
        }
        
        /* Force ALL elements to avoid colored backgrounds */
        * {
          box-sizing: border-box;
        }
        
        *:not(input):not(textarea):not(select) {
          background-color: transparent !important;
        }
        
        /* Ensure entire page is covered */
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 200vh;
          background: #ffffff;
          z-index: -1000;
        }
        
        /* Additional coverage for scrolling */
        html::before {
          content: '';
          position: fixed;
          top: -100vh;
          left: -100vw;
          width: 300vw;
          height: 300vh;
          background: #ffffff;
          z-index: -2000;
        }
      `}</style>
      <div style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#ffffff',
        minHeight: '100vh',
        height: '100%',
        color: '#1a1a1a',
        position: 'relative'
      }}>
      {/* Main Container - 2 Column Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        height: '100vh',
        minHeight: '100vh',
        gap: 0,
        background: '#ffffff'
      }}>
        
        {/* Left Column - Main App */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: '#f8fafc',
          borderRight: '1px solid #e2e8f0'
        }}>
          
          {/* Header */}
          <div style={{
            padding: '24px 32px',
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            <h1 style={{
              fontSize: '28px',
              fontWeight: '700',
              margin: 0,
              color: '#2563eb',
              letterSpacing: '-0.5px'
            }}>
              Contact Center
            </h1>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                background: isConnected ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: isConnected ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '25px',
                fontSize: '14px',
                fontWeight: '600',
                color: isConnected ? '#16a34a' : '#dc2626',
                boxShadow: isConnected 
                  ? '0 4px 6px -1px rgba(34, 197, 94, 0.1)' 
                  : '0 4px 6px -1px rgba(239, 68, 68, 0.1)',
                transition: 'all 0.3s ease'
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: isConnected ? '#22c55e' : '#ef4444'
                }} />
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                {isConnected && avatarConnected && (
                  <span style={{ color: '#2563eb' }}>• Avatar Active</span>
                )}
              </div>
              
              <button 
                onClick={startSession}
                disabled={isConnected || !config.agent_id}
                style={{
                  padding: '12px 24px',
                  background: isConnected 
                    ? 'rgba(148, 163, 184, 0.1)' 
                    : !config.agent_id
                    ? 'rgba(148, 163, 184, 0.1)'
                    : 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                  border: 'none',
                  borderRadius: '12px',
                  color: (isConnected || !config.agent_id) ? '#64748b' : 'white',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: (isConnected || !config.agent_id) ? 'not-allowed' : 'pointer',
                  opacity: (isConnected || !config.agent_id) ? 0.5 : 1,
                  boxShadow: (isConnected || !config.agent_id) ? 'none' : '0 8px 25px -8px rgba(59, 130, 246, 0.4)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)'
                }}
                onMouseEnter={(e) => {
                  if (!isConnected && config.agent_id) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 12px 35px -8px rgba(59, 130, 246, 0.5)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isConnected && config.agent_id) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 8px 25px -8px rgba(59, 130, 246, 0.4)';
                  }
                }}
              >
                {isConnected ? 'Session Active' : !config.agent_id ? 'Create Agent First' : 'Start Session'}
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
            gap: '24px',
            overflowY: 'auto',
            background: '#ffffff'
          }}>
            
            {/* Video Boxes Section */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '24px',
              padding: '32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.3s ease'
            }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                margin: '0 0 24px 0',
                color: '#2563eb',
                textAlign: 'center'
              }}>
                Participants
              </h2>
              
              {/* Two Boxes Row - Leftmost and Rightmost */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px',
                width: '100%',
                paddingLeft: '20px',
                paddingRight: '20px'
              }}>
                {/* User Box */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{
                    position: 'relative',
                    width: '280px',
                    height: '200px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '20px',
                    overflow: 'hidden',
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 25px -8px rgba(59, 130, 246, 0.3)',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      background: 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '32px',
                      color: 'white'
                    }}>
                      👤
                    </div>
                  </div>
                  <div style={{
                    marginTop: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#2563eb'
                  }}>
                    User
                  </div>
                </div>

                {/* Avatar Box */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{
                    position: 'relative',
                    width: '280px',
                    height: '200px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '20px',
                    overflow: 'hidden',
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                    boxShadow: '0 8px 25px -8px rgba(59, 130, 246, 0.3)',
                    transition: 'all 0.3s ease'
                  }}>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted={false}
                      controls={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                    {!avatarConnected && !avatarLoading && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        color: '#2563eb'
                      }}>
                        <div style={{
                          fontSize: '32px',
                          opacity: 0.6
                        }}>
                          🎭
                        </div>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: '500',
                          textAlign: 'center'
                        }}>
                          Avatar Disconnected
                        </div>
                      </div>
                    )}
                    {avatarLoading && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        color: '#60a5fa'
                      }}>
                        <div style={{
                          fontSize: '24px',
                          animation: 'spin 1s linear infinite'
                        }}>
                          ⏳
                        </div>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: '500'
                        }}>
                          Connecting...
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{
                    marginTop: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#2563eb'
                  }}>
                    Avatar
                  </div>
                </div>
              </div>

              {/* Transcriptions Below Boxes - Aligned with Video Boxes */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                paddingLeft: '20px',
                paddingRight: '20px'
              }}>
                {/* User Transcription */}
                <div style={{
                  background: 'rgba(59, 130, 246, 0.05)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '16px',
                  padding: '16px',
                  minHeight: '70px',
                  width: '280px',
                  boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.1)',
                  transition: 'all 0.3s ease'
                }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#2563eb',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>👤</span>
                    <span>USER</span>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: '#374151'
                  }}>
                    {(() => {
                      const lastUserMessage = recentMessages
                        .filter(m => m.role === 'user')
                        .slice(-1)[0];
                      
                      return lastUserMessage ? (
                        <div>
                          {lastUserMessage.content}
                          <div style={{
                            fontSize: '10px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            marginTop: '4px'
                          }}>
                            {lastUserMessage.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#2563eb', fontStyle: 'italic' }}>
                          Start talking...
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Avatar Transcription */}
                <div style={{
                  background: 'rgba(34, 197, 94, 0.05)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '16px',
                  padding: '16px',
                  minHeight: '70px',
                  width: '280px',
                  boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.1)',
                  transition: 'all 0.3s ease'
                }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#16a34a',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>🤖</span>
                    <span>AVATAR</span>
                    {currentAssistantMessage && (
                      <span style={{
                        fontSize: '10px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        color: '#22c55e'
                      }}>
                        Speaking...
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: '#374151'
                  }}>
                    {currentAssistantMessage ? (
                      <div>
                        {currentAssistantMessage}
                        <span style={{
                          display: 'inline-block',
                          width: '2px',
                          height: '14px',
                          background: '#22c55e',
                          marginLeft: '4px',
                          animation: 'blink 1s infinite'
                        }} />
                      </div>
                    ) : (
                      (() => {
                        const lastAssistantMessage = recentMessages
                          .filter(m => m.role === 'assistant')
                          .slice(-1)[0];
                        
                        return lastAssistantMessage ? (
                          <div>
                            {lastAssistantMessage.content}
                            <div style={{
                              fontSize: '10px',
                              color: 'rgba(255, 255, 255, 0.5)',
                              marginTop: '4px'
                            }}>
                              {lastAssistantMessage.timestamp.toLocaleTimeString()}
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#2563eb', fontStyle: 'italic' }}>
                            Waiting for response...
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              </div>

              {/* Avatar Controls */}
              <div style={{
                marginTop: '20px',
                display: 'flex',
                justifyContent: 'center',
                gap: '12px'
              }}>
                {!isConnected ? (
                  <div style={{ color: '#2563eb', fontSize: '14px' }}>
                    Start a session to connect avatar
                  </div>
                ) : avatarLoading ? (
                  <button disabled style={{
                    padding: '8px 16px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '14px',
                    cursor: 'not-allowed'
                  }}>
                    Connecting...
                  </button>
                ) : avatarConnected ? (
                  <button onClick={disconnectAvatar} style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)'
                  }}>
                    Disconnect Avatar
                  </button>
                ) : (
                  <button onClick={connectAvatar} style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(45deg, #22c55e, #16a34a)',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)'
                  }}>
                    Connect Avatar
                  </button>
                )}
              </div>
            </div>

            {/* Conversation Section */}
            <div style={{
              flex: 1,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '24px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: '300px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.3s ease'
            }}>
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  margin: 0,
                  color: '#2563eb'
                }}>
                  Conversation
                </h3>
                {messages.length > 0 && (
                  <button 
                    onClick={clearConversationHistory}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Clear History
                  </button>
                )}
              </div>
              
              <div style={{
                flex: 1,
                padding: '16px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {recentMessages.map((message) => (
                  <div key={message.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: message.role === 'user' ? 'flex-end' : 'flex-start'
                  }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '12px 16px',
                      borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: message.role === 'user' 
                        ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                        : 'rgba(255, 255, 255, 0.1)',
                      border: message.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
                      color: 'white',
                      fontSize: '14px',
                      lineHeight: '1.5'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        opacity: 0.7,
                        marginBottom: '4px',
                        fontWeight: '500'
                      }}>
                        {message.role === 'user' ? '👤 You' : '🤖 Assistant'}
                      </div>
                      {message.content}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.5)',
                      marginTop: '4px',
                      marginLeft: message.role === 'user' ? '0' : '8px',
                      marginRight: message.role === 'user' ? '8px' : '0'
                    }}>
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                
                {currentAssistantMessage && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '12px 16px',
                      borderRadius: '16px 16px 16px 4px',
                      background: 'rgba(34, 197, 94, 0.2)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: 'white',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      position: 'relative'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        opacity: 0.7,
                        marginBottom: '4px',
                        fontWeight: '500'
                      }}>
                        🤖 Assistant (speaking...)
                      </div>
                      {currentAssistantMessage}
                      <span style={{
                        display: 'inline-block',
                        width: '2px',
                        height: '16px',
                        background: '#22c55e',
                        marginLeft: '4px',
                        animation: 'blink 1s infinite'
                      }} />
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
              
              {/* Input Section */}
              <div style={{
                padding: '20px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-end'
              }}>
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!isConnected}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isRecording 
                      ? 'linear-gradient(45deg, #ef4444, #dc2626)'
                      : isConnected 
                        ? 'linear-gradient(45deg, #22c55e, #16a34a)'
                        : 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    fontSize: '20px',
                    cursor: isConnected ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isRecording ? '0 4px 15px rgba(239, 68, 68, 0.4)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {isRecording ? '⏹️' : '🎤'}
                </button>
                
                <form onSubmit={handleTextSubmit} style={{
                  flex: 1,
                  display: 'flex',
                  gap: '8px'
                }}>
                  <input
                    type="text"
                    name="message"
                    placeholder="Type your message..."
                    disabled={!isConnected}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: '#ffffff',
                      border: '1px solid #d1d5db',
                      borderRadius: '24px',
                      color: '#374151',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <button 
                    type="submit" 
                    disabled={!isConnected}
                    style={{
                      padding: '12px 20px',
                      background: isConnected 
                        ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                        : 'rgba(148, 163, 184, 0.3)',
                      border: 'none',
                      borderRadius: '24px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: isConnected ? 'pointer' : 'not-allowed',
                      boxShadow: isConnected ? '0 2px 8px rgba(59, 130, 246, 0.3)' : 'none'
                    }}
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Configuration Panel */}
        <div style={{
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh'
        }}>
          
          {/* Configuration Header */}
          <div style={{
            padding: '24px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
            flexShrink: 0,
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '700',
              margin: 0,
              color: '#2563eb',
              letterSpacing: '-0.3px'
            }}>
              Configuration
            </h2>
          </div>

          {/* Configuration Content - Scrollable */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            background: '#f8fafc'
          }}>
            
            {/* Agent Status */}
            {agentStatus.has_agent && (
              <div style={{ 
                marginBottom: '24px',
                padding: '20px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '16px',
                boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.1)',
                transition: 'all 0.3s ease'
              }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#22c55e',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  ✅ Agent Configured
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#374151',
                  marginBottom: '4px'
                }}>
                  Agent ID: {config.agent_id}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#374151'
                }}>
                  Status: {agentStatus.ready_for_session ? 'Ready for sessions' : 'Configuration incomplete'}
                </div>
              </div>
            )}
            
            {/* Agent Information */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#2563eb',
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Agent Configuration
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  Model
                </label>
                <select
                  value={config.model}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '14px',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-realtime-preview">GPT-4o Realtime Preview</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  Name
                </label>
                <input
                  type="text"
                  value={config.agent_name}
                  onChange={(e) => updateConfig({ agent_name: e.target.value })}
                  placeholder="Enter agent name..."
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '14px',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  Instructions
                </label>
                <textarea
                  value={config.instructions}
                  onChange={(e) => updateConfig({ instructions: e.target.value })}
                  placeholder="Enter instructions for the AI agent..."
                  style={{
                    width: '100%',
                    height: '120px',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>
              
              {config.agent_id && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#2563eb',
                    marginBottom: '6px'
                  }}>
                    Current Agent ID
                  </label>
                  <div style={{
                    padding: '12px 16px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '12px',
                    color: '#22c55e',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    boxShadow: '0 2px 4px 0 rgba(34, 197, 94, 0.1)'
                  }}>
                    {config.agent_id}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <button
                onClick={saveConfiguration}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: agentStatus.has_agent 
                    ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                    : 'linear-gradient(45deg, #22c55e, #16a34a)',
                  border: 'none',
                  borderRadius: '16px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: agentStatus.has_agent 
                    ? '0 10px 25px -5px rgba(59, 130, 246, 0.4)'
                    : '0 10px 25px -5px rgba(34, 197, 94, 0.4)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = agentStatus.has_agent 
                    ? '0 15px 35px -5px rgba(59, 130, 246, 0.5)'
                    : '0 15px 35px -5px rgba(34, 197, 94, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = agentStatus.has_agent 
                    ? '0 10px 25px -5px rgba(59, 130, 246, 0.4)'
                    : '0 10px 25px -5px rgba(34, 197, 94, 0.4)';
                }}
              >
                {agentStatus.has_agent ? '🔄 Update Agent' : '🤖 Create Agent'}
              </button>
              
              {agentStatus.has_agent && (
                <button
                  onClick={async () => {
                    if (confirm('Are you sure you want to reset the agent configuration? This will clear the current agent.')) {
                      try {
                        const response = await fetch('/api/config/agent', { method: 'DELETE' });
                        if (response.ok) {
                          setConfig(prev => ({ ...prev, agent_id: '' }));
                          setAgentStatus({ has_agent: false, ready_for_session: false });
                          alert('Agent configuration has been reset.');
                        }
                      } catch (error) {
                        alert('Failed to reset agent configuration.');
                      }
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                    border: 'none',
                    borderRadius: '12px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    boxShadow: '0 6px 20px -5px rgba(239, 68, 68, 0.4)',
                    transition: 'all 0.3s ease',
                    transform: 'translateY(0)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(239, 68, 68, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 6px 20px -5px rgba(239, 68, 68, 0.4)';
                  }}
                >
                  🗑️ Reset Agent
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* CSS Animations */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        body {
          background: #ffffff;
          margin: 0;
          padding: 0;
          animation: fadeIn 0.6s ease-out;
        }
        
        /* Enhanced scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
        }

        ::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
          background: linear-gradient(45deg, rgba(59, 130, 246, 0.3), rgba(59, 130, 246, 0.5));
          border-radius: 4px;
          transition: all 0.3s ease;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(45deg, rgba(59, 130, 246, 0.5), rgba(59, 130, 246, 0.7));
        }
        
        /* Smooth focus transitions */
        input:focus, textarea:focus, select:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
        }
        
        /* Button hover effects */
        button:not(:disabled):hover {
          transition: all 0.3s ease;
        }
        
        /* Card hover effects */
        .card-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
      `}</style>
    </div>
    </>
  );
};

export default App;