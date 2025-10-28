# Voice Live AI Contact Center# Voice Agent with Avatar - Complete Project Structure



A modern AI-powered contact center application using Azure Voice Live with real-time audio and avatar capabilities.This project provides a complete voice agent application with avatar support using Azure Voice Live API.



## Features## Project Structure



- 🎙️ Real-time voice conversation with AI```

- 👤 Animated avatar supportvoiceagent/

- 💬 Text and voice input├── voiceagent.py              # Original voice agent with avatar (terminal)

- 📊 Live transcription for both user and assistant├── voiceagent_audio_only.py   # Audio-only version (terminal)

- 🔄 WebRTC integration for video streaming├── test_avatar_batch.py       # Avatar testing script

- 🎨 Modern, responsive UI├── requirements.txt           # Python dependencies

├── backend/                   # FastAPI backend for web interface

## Prerequisites│   ├── main.py               # FastAPI server with REST & WebSocket APIs

│   ├── session_manager.py    # Voice Live session management

- Python 3.8+│   └── voice_live_client.py  # Azure Voice Live client wrapper

- Node.js 16+└── frontend/                 # React TypeScript frontend

- Azure subscription with Voice Live access    ├── src/

- Azure credentials configured (DefaultAzureCredential)    │   ├── App.tsx           # Main React component

    │   ├── App.css           # Styling

## Setup    │   ├── main.tsx          # React entry point

    │   └── index.css         # Global styles

### 1. Clone the repository    ├── index.html            # HTML template

    ├── package.json          # Node.js dependencies

```bash    ├── vite.config.ts        # Vite build configuration

git clone <your-repo-url>    ├── tsconfig.json         # TypeScript configuration

cd voiceagent    └── tsconfig.node.json    # TypeScript config for build tools

``````



### 2. Configure environment variables## Features



Copy the example environment file and fill in your Azure credentials:### 1. Terminal Voice Agent (`voiceagent.py`)

- **Full avatar support** with Lisa character (casual-sitting style)

```bash- **Audio delivered via WebRTC** (not directly in terminal)

cp .env.example .env- **Real-time conversation** with Azure Voice Live API

```- **Enhanced event logging** for debugging



Edit `.env` and add your Azure Voice Live configuration:### 2. Audio-Only Version (`voiceagent_audio_only.py`)

- **Direct audio playback** in terminal

```env- **Reliable voice conversations** without avatar complexity

AZURE_VOICE_LIVE_ENDPOINT=https://your-endpoint.cognitiveservices.azure.com/- **WebSocket audio streaming**

AZURE_VOICE_LIVE_AGENT_ID=your_agent_id- **Immediate testing capability**

AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING=region.api.azureml.ms;workspace-id;resource-group;project-name

# ... (see .env.example for all required variables)### 3. Web Application

```- **FastAPI backend** with session management

- **React frontend** with avatar video display

### 3. Install Python dependencies- **WebRTC integration** for avatar video streams

- **Real-time audio and text communication**

```bash- **Modern responsive UI**

pip install -r requirements.txt

```## Setup Instructions



### 4. Install frontend dependencies### Prerequisites

- Python 3.8+

```bash- Node.js 18+

cd frontend- Azure Cognitive Services account

npm install- Azure Voice Live API access

cd ..

```### Backend Setup



### 5. Run the application1. **Install Python dependencies:**

```bash

**Option 1: Simple script (recommended for testing)**pip install -r requirements.txt

```

```bash

python voiceagent.py2. **Configure environment variables:**

```Create a `.env` file with your Azure credentials:

```env

This will start both the backend server and frontend development server.AZURE_VOICE_LIVE_ENDPOINT=https://your-endpoint.cognitiveservices.azure.com/

AZURE_VOICE_LIVE_AGENT_ID=your-agent-id

**Option 2: Manual setup**AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING=your-connection-string

AZURE_VOICE_LIVE_API_VERSION=2025-10-01

Start the backend server:AZURE_TTS_VOICE=en-IN-AartiIndicNeural

```bashAZURE_VOICE_AVATAR_CHARACTER=lisa

cd backendAZURE_VOICE_AVATAR_STYLE=casual-sitting

uvicorn main:app --host 0.0.0.0 --port 3000 --reload```

```

3. **Run the FastAPI backend:**

In a separate terminal, start the frontend:```bash

```bashcd backend

cd frontendpython -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

npm run dev```

```

### Frontend Setup

## Usage

1. **Install Node.js dependencies:**

1. Open your browser to `http://localhost:5173` (or the URL shown by Vite)```bash

2. Click "Start Session" to initialize the connectioncd frontend

3. Click "Connect Avatar" to enable video avatarnpm install

4. Use the microphone button to speak or type messages in the text input```

5. View real-time transcriptions and conversation history

2. **Start the development server:**

## Project Structure```bash

npm start

``````

voiceagent/

├── backend/The frontend will be available at `http://localhost:3000`

│   ├── main.py                 # FastAPI server

│   ├── voice_live_client.py   # Azure Voice Live client### Terminal Testing

│   └── session_manager.py     # Session management

├── frontend/1. **Test avatar configuration:**

│   ├── src/```bash

│   │   ├── App.tsx            # Main React componentpython test_avatar_batch.py

│   │   └── App.css            # Styling```

│   └── package.json

├── voiceagent.py              # Simple launcher script2. **Test audio-only conversation:**

├── requirements.txt           # Python dependencies```bash

└── .env.example              # Environment templatepython voiceagent_audio_only.py

``````



## Environment Variables3. **Test full avatar version:**

```bash

| Variable | Description | Required |python voiceagent.py

|----------|-------------|----------|```

| `AZURE_VOICE_LIVE_ENDPOINT` | Azure Voice Live endpoint URL | Yes |

| `AZURE_VOICE_LIVE_AGENT_ID` | Your agent ID | Yes |## Usage

| `AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING` | Agent connection string | Yes |

| `AZURE_VOICE_LIVE_API_VERSION` | API version (e.g., 2025-10-01) | Yes |### Web Application

| `AZURE_TTS_VOICE` | Azure TTS voice name | Yes |1. Open `http://localhost:3000` in your browser

| `AZURE_VOICE_AVATAR_CHARACTER` | Avatar character name | Yes |2. Click "Start Session" to initialize the voice agent

| `AZURE_VOICE_AVATAR_STYLE` | Avatar style | Yes |3. Click "Connect Avatar" to establish WebRTC video connection

| `AZURE_VOICE_AVATAR_WIDTH` | Video width in pixels | Yes |4. Use the microphone button to talk or type messages

| `AZURE_VOICE_AVATAR_HEIGHT` | Video height in pixels | Yes |5. Watch the avatar respond with synchronized video and audio

| `AZURE_VOICE_AVATAR_BITRATE` | Video bitrate | Yes |

| `AZURE_VOICE_AVATAR_ICE_URLS` | Custom ICE servers (optional) | No |### Terminal Application

1. Run `python voiceagent_audio_only.py` for reliable voice chat

## Authentication2. Run `python voiceagent.py` for avatar-enabled session (requires WebRTC frontend)

3. Press 'q' and Enter to quit

This application uses `DefaultAzureCredential` from Azure Identity. Make sure you're authenticated using one of:

## Technical Details

- Azure CLI: `az login`

- Environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)### Authentication

- Managed Identity (when deployed to Azure)- Uses `DefaultAzureCredential` for Azure authentication

- Requires both `https://ai.azure.com/.default` and `https://ml.azure.com/.default` scopes

## Troubleshooting- Automatic token refresh handling



### Avatar not connecting### Audio Processing

- Check your ICE server configuration- **24kHz sample rate** for optimal quality

- Verify network connectivity- **Real-time audio streaming** with minimal latency

- Ensure WebRTC is supported in your browser- **Azure Deep Noise Suppression** for clear audio

- **Server Echo Cancellation** for better conversation flow

### Audio not working

- Check microphone permissions in your browser### Avatar Features

- Verify audio device is working- **Lisa character** with casual-sitting style

- Check browser console for errors- **1280x720 resolution** at 2Mbps bitrate

- **WebRTC video streaming** for real-time avatar display

### Session connection fails- **Synchronized lip-sync** with audio response

- Verify all environment variables are set correctly

- Check Azure credentials are valid### API Endpoints

- Review backend logs for detailed error messages- `POST /api/session` - Create new voice session

- `GET /api/session/{session_id}` - Get session status

## License- `POST /api/session/{session_id}/avatar/connect` - Connect avatar via WebRTC

- `POST /api/session/{session_id}/message` - Send text message

MIT- `WebSocket /api/ws/{session_id}` - Real-time event streaming



## Contributing## Troubleshooting



Pull requests are welcome! Please ensure all sensitive information is removed before committing.### Common Issues


1. **Audio not working in terminal:**
   - Use `voiceagent_audio_only.py` for direct audio playback
   - Avatar version requires WebRTC frontend for audio

2. **WebSocket connection failed:**
   - Check Azure credentials and endpoint configuration
   - Verify agent ID and connection string are correct

3. **Avatar not connecting:**
   - Ensure WebRTC is supported in your browser
   - Check firewall settings for UDP traffic

4. **No microphone access:**
   - Grant microphone permissions in browser
   - Check microphone is not being used by another application

### Debug Mode
Add verbose logging for troubleshooting:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Development

### Adding New Features
1. Backend changes go in `backend/main.py` or `session_manager.py`
2. Frontend changes go in `frontend/src/App.tsx`
3. Voice agent logic updates go in `voice_live_client.py`

### Building for Production
```bash
# Build frontend
cd frontend
npm run build

# Deploy backend with production ASGI server
pip install gunicorn
gunicorn backend.main:app -w 4 -k uvicorn.workers.UvicornWorker
```

## License

This project is for educational and development purposes. Please ensure compliance with Azure service terms and conditions.