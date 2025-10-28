import os
import uuid
import json
import time
import base64
import logging
import threading
import numpy as np
import sounddevice as sd
import queue
import signal
import sys

from collections import deque
from dotenv import load_dotenv
from azure.identity import DefaultAzureCredential
import websocket
from datetime import datetime

# Global variables for thread coordination
stop_event = threading.Event()

AUDIO_SAMPLE_RATE = 24000

class VoiceLiveConnection:
    def __init__(self, url: str, headers: dict):
        self._url = url
        self._headers = headers
        self._ws = None
        self._message_queue = queue.Queue()
        self._connected = False

    def connect(self):
        def on_message(ws, message):
            self._message_queue.put(message)
        
        def on_error(ws, error):
            print(f"WebSocket error: {error}")
        
        def on_close(ws, close_status_code, close_msg):
            print("WebSocket connection closed")
            self._connected = False
        
        def on_open(ws):
            print("WebSocket connection opened")
            self._connected = True

        self._ws = websocket.WebSocketApp(
            self._url,
            header=self._headers,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
            on_open=on_open
        )
        
        self._ws_thread = threading.Thread(target=self._ws.run_forever)
        self._ws_thread.daemon = True
        self._ws_thread.start()
        
        timeout = 10
        start_time = time.time()
        while not self._connected and time.time() - start_time < timeout:
            time.sleep(0.1)
        
        if not self._connected:
            raise ConnectionError("Failed to establish WebSocket connection")

    def recv(self):
        try:
            return self._message_queue.get(timeout=1)
        except queue.Empty:
            return None

    def send(self, message: str):
        if self._ws and self._connected:
            self._ws.send(message)

    def close(self):
        if self._ws:
            self._ws.close()
            self._connected = False

class AzureVoiceLive:
    def __init__(self, *, azure_endpoint=None, api_version=None, token=None, api_key=None):
        self._azure_endpoint = azure_endpoint
        self._api_version = api_version
        self._token = token
        self._api_key = api_key
        self._connection = None

    def connect(self, agent_connection_string: str, agent_id: str, agent_access_token: str):
        if self._connection is not None:
            raise ValueError("Already connected to the Voice Live API.")
        if not agent_connection_string:
            raise ValueError("Agent connection string is required.")
        if not agent_id:
            raise ValueError("Agent ID is required.")
        if not agent_access_token:
            raise ValueError("Agent access token is required.")

        azure_ws_endpoint = self._azure_endpoint.rstrip('/').replace("https://", "wss://")
        url = f"{azure_ws_endpoint}/voice-live/realtime?api-version={self._api_version}&agent-connection-string={agent_connection_string}&agent-id={agent_id}&agent-access-token={agent_access_token}"

        auth_header = {"Authorization": f"Bearer {self._token}"} if self._token else {"api-key": self._api_key}
        request_id = uuid.uuid4()
        headers = {"x-ms-client-request-id": str(request_id), **auth_header}

        self._connection = VoiceLiveConnection(url, headers)
        self._connection.connect()
        return self._connection

class AudioPlayerAsync:
    def __init__(self):
        self.queue = deque()
        self.lock = threading.Lock()
        self.stream = sd.OutputStream(
            callback=self.callback,
            samplerate=AUDIO_SAMPLE_RATE,
            channels=1,
            dtype=np.int16,
            blocksize=2400,
        )
        self.playing = False

    def callback(self, outdata, frames, time, status):
        if status:
            print(f"Stream status: {status}")
        with self.lock:
            data = np.empty(0, dtype=np.int16)
            while len(data) < frames and len(self.queue) > 0:
                item = self.queue.popleft()
                frames_needed = frames - len(data)
                data = np.concatenate((data, item[:frames_needed]))
                if len(item) > frames_needed:
                    self.queue.appendleft(item[frames_needed:])
            if len(data) < frames:
                data = np.concatenate((data, np.zeros(frames - len(data), dtype=np.int16)))
        outdata[:] = data.reshape(-1, 1)

    def add_data(self, data: bytes):
        with self.lock:
            np_data = np.frombuffer(data, dtype=np.int16)
            self.queue.append(np_data)
            if not self.playing and len(self.queue) > 0:
                self.start()

    def start(self):
        if not self.playing:
            self.playing = True
            self.stream.start()

    def stop(self):
        with self.lock:
            self.queue.clear()
        self.playing = False
        self.stream.stop()

    def terminate(self):
        with self.lock:
            self.queue.clear()
        self.stream.stop()
        self.stream.close()

def listen_and_send_audio(connection: VoiceLiveConnection):
    stream = sd.InputStream(channels=1, samplerate=AUDIO_SAMPLE_RATE, dtype="int16")
    try:
        stream.start()
        read_size = int(AUDIO_SAMPLE_RATE * 0.02)
        while not stop_event.is_set():
            if stream.read_available >= read_size:
                data, _ = stream.read(read_size)
                audio = base64.b64encode(data).decode("utf-8")
                param = {"type": "input_audio_buffer.append", "audio": audio, "event_id": ""}
                data_json = json.dumps(param)
                connection.send(data_json)
            else:
                time.sleep(0.001)
    except Exception as e:
        print(f"Audio stream interrupted. {e}")
    finally:
        stream.stop()
        stream.close()

def receive_audio_and_playback(connection: VoiceLiveConnection):
    audio_player = AudioPlayerAsync()
    try:
        while not stop_event.is_set():
            raw_event = connection.recv()
            if raw_event is None:
                continue
            try:
                event = json.loads(raw_event)
                event_type = event.get("type")
                
                # Enhanced event handling with meaningful output
                if event_type == "session.created":
                    session = event.get("session", {})
                    print(f"✅ Session created: {session.get('id', 'Unknown')}")
                
                elif event_type == "session.updated":
                    print("🔄 Session configuration updated")
                
                elif event_type == "input_audio_buffer.speech_started":
                    print("🎤 Speech detected - listening...")
                    audio_player.stop()
                
                elif event_type == "input_audio_buffer.speech_stopped":
                    print("⏸️  Speech ended - processing...")
                
                elif event_type == "conversation.item.input_audio_transcription.completed":
                    user_transcript = event.get("transcript", "")
                    print(f"\n👤 You said: {user_transcript}")
                
                elif event_type == "response.audio_transcript.delta":
                    # Show agent response as it's being generated
                    delta = event.get("delta", "")
                    print(delta, end="", flush=True)
                
                elif event_type == "response.audio_transcript.done":
                    agent_transcript = event.get("transcript", "")
                    print(f"\n🤖 Agent: {agent_transcript}\n")
                
                elif event_type == "response.audio.delta":
                    # Handle audio playback
                    bytes_data = base64.b64decode(event.get("delta", ""))
                    if bytes_data:
                        print(f"🔊 Received audio chunk: {len(bytes_data)} bytes")
                        audio_player.add_data(bytes_data)
                    else:
                        print("🔊 Empty audio delta received")
                
                elif event_type == "response.audio.done":
                    print("🔊 Audio response completed")
                
                elif event_type == "session.avatar.connecting":
                    print("📹 Avatar connecting...")
                
                elif event_type == "session.avatar.connected":
                    print("📹 Avatar connected - video stream ready!")
                
                elif event_type == "session.avatar.disconnected":
                    print("📹 Avatar disconnected")
                
                elif event_type == "response.done":
                    print("✅ Response completed\n")
                
                elif event_type == "error":
                    error_details = event.get("error", {})
                    error_type = error_details.get("type", "Unknown")
                    error_message = error_details.get("message", "No message provided")
                    print(f"❌ Error: {error_type} - {error_message}")
                
                # Only show event type for other events (less verbose)
                elif event_type not in [
                    "input_audio_buffer.append",
                    # "response.audio.delta"  # Temporarily enable to debug
                ]:
                    print(f"📡 Event: {event_type}")
                    # Debug: Show if this is an audio-related event we're missing
                    if "audio" in event_type.lower():
                        print(f"   � Audio event details: {event}")
                    
            except json.JSONDecodeError:
                continue
    except Exception as e:
        print(f"Error in audio playback: {e}")
    finally:
        audio_player.terminate()

def read_keyboard_and_quit():
    print("Press 'q' and Enter to quit the chat.")
    while not stop_event.is_set():
        try:
            user_input = input()
            if user_input.strip().lower() == 'q':
                print("Quitting the chat...")
                stop_event.set()
                break
        except EOFError:
            break

def main():
    endpoint = "https://realtimehub010311526755.cognitiveservices.azure.com/"
    agent_id = "asst_hqXlCZLmYmu8isX7TJaLGPxB"
    agent_connection_string = "eastus2.api.azureml.ms;154396ac-15fb-44d7-9927-35eaea9d57e6;rg-jyothikakoppula11-3861_ai;realtimeproject01"
    api_version = "2025-10-01"

    credential = DefaultAzureCredential()
    scopes = "https://ai.azure.com/.default"
    token = credential.get_token(scopes)

    client = AzureVoiceLive(
        azure_endpoint=endpoint,
        api_version=api_version,
        token=token.token,
    )

    agent_scopes = "https://ml.azure.com/.default"
    agent_token = credential.get_token(agent_scopes)
    agent_access_token = agent_token.token
    connection = client.connect(
        agent_connection_string=agent_connection_string,
        agent_id=agent_id,
        agent_access_token=agent_access_token
    )

    session_update = {
        "type": "session.update",
        "session": {
            "modalities": ["text", "audio", "avatar"],
            "turn_detection": {
                "type": "azure_semantic_vad",
                "threshold": 0.3,
                "prefix_padding_ms": 200,
                "silence_duration_ms": 200,
                "remove_filler_words": False,
                "end_of_utterance_detection": {
                    "model": "semantic_detection_v1",
                    "threshold": 0.01,
                    "timeout": 2,
                },
            },
            "input_audio_noise_reduction": {
                "type": "azure_deep_noise_suppression"
            },
            "input_audio_echo_cancellation": {
                "type": "server_echo_cancellation"
            },
            "avatar": {
                "character": "lisa",
                "style": "casual-sitting",
                "customized": False,
                "video": {
                    "resolution": {"width": 1280, "height": 720},
                    "bitrate": 2000000
                }
            },
            "voice": {
                "name": "en-IN-AartiIndicNeural",
                "type": "azure-standard",
                "temperature": 0.8,
            },
        },
        "event_id": ""
    }
    connection.send(json.dumps(session_update))
    print("🎙️  Voice Assistant with Avatar Session Started")
    print("📹 Avatar: Lisa (casual-sitting) - WebRTC stream ready")
    print("🔊 Audio delivered via WebRTC (no direct audio in terminal)")

    send_thread = threading.Thread(target=listen_and_send_audio, args=(connection,))
    receive_thread = threading.Thread(target=receive_audio_and_playback, args=(connection,))
    keyboard_thread = threading.Thread(target=read_keyboard_and_quit)

    print("🚀 Starting voice chat...")
    send_thread.start()
    receive_thread.start()
    keyboard_thread.start()

    keyboard_thread.join()
    stop_event.set()
    send_thread.join(timeout=2)
    receive_thread.join(timeout=2)
    connection.close()
    print("👋 Chat session ended.")

if __name__ == "__main__":
    try:
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        load_dotenv("./.env", override=True)
        def signal_handler(signum, frame):
            print("\nReceived interrupt signal, shutting down...")
            stop_event.set()
            sys.exit(0)
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        main()
    except Exception as e:
        print(f"Error: {e}")
        stop_event.set()