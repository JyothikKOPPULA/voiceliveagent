from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import requests
from pathlib import Path
from dotenv import load_dotenv
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from session_manager import SessionManager
from config import agent_config

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


class SessionResponse(BaseModel):
    session_id: str


class AvatarOfferRequest(BaseModel):
    client_sdp: str


class AvatarAnswerResponse(BaseModel):
    server_sdp: str


class TextMessageRequest(BaseModel):
    text: str


class AudioCommitResponse(BaseModel):
    status: str


class ConfigUpdate(BaseModel):
    model: str = "gpt-4o-mini"
    agent_name: str = "voice-agent"
    instructions: str = "You are an AI Voice Assistant designed to have natural conversations with users."


class ConfigResponse(BaseModel):
    model: str
    agent_name: str
    instructions: str
    agent_id: str = ""


class AgentCreateResponse(BaseModel):
    agent_id: str
    status: str
    message: str = ""


session_manager = SessionManager()

# Load environment variables
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def update_env_file(key: str, value: str) -> None:
    """Update or add a key-value pair in the .env file."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content with UTF-8 encoding
    lines = []
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    # Update or add the key
    updated = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            updated = True
            break
    
    if not updated:
        lines.append(f"{key}={value}\n")
    
    # Write back to file with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    # Update current environment
    os.environ[key] = value


def batch_update_env_file(updates: Dict[str, str]) -> None:
    """Update multiple key-value pairs in the .env file efficiently."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content with UTF-8 encoding
    lines = []
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    # Update existing keys and track which ones we've updated
    updated_keys = set()
    for i, line in enumerate(lines):
        for key, value in updates.items():
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                updated_keys.add(key)
                break
    
    # Add new keys that weren't found
    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}\n")
    
    # Write back to file with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    # Update current environment
    for key, value in updates.items():
        os.environ[key] = value


def update_env_batch(updates: dict) -> None:
    """Update multiple key-value pairs in the .env file efficiently."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content
    lines = []
    if env_path.exists():
        with open(env_path, 'r') as f:
            lines = f.readlines()
    
    # Update existing keys and track which ones were updated
    updated_keys = set()
    for i, line in enumerate(lines):
        for key, value in updates.items():
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                updated_keys.add(key)
                break
    
    # Add new keys that weren't found
    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}\n")
    
    # Write back to file once
    with open(env_path, 'w') as f:
        f.writelines(lines)
    
    # Update current environment
    for key, value in updates.items():
        os.environ[key] = value


async def create_azure_agent(model: str, name: str, instructions: str) -> str:
    """Create an Azure AI agent and return the agent ID."""
    try:
        # Get connection string from environment
        connection_string = os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING")
        if not connection_string:
            raise ValueError("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING environment variable is required")
        
        # Create project client
        project_client = AIProjectClient.from_connection_string(
            credential=DefaultAzureCredential(),
            conn_str=connection_string,
        )
        
        # Create agent
        agent = project_client.agents.create_agent(
            model=model,
            name=name,
            instructions=instructions,
            tools=[],  # No tools for now as requested
        )
        
        logger.info(f"Created agent with ID: {agent.id}")
        return agent.id
        
    except Exception as e:
        logger.error(f"Failed to create agent: {str(e)}")
        raise


async def warmup_ecom_api():
    """Warm up the ecom API by calling the /openapi endpoint"""
    ecom_api_url = os.getenv("ecom_api_url")
    if not ecom_api_url:
        logger.warning("ecom_api_url not configured, skipping API warmup")
        return
    
    warmup_url = f"{ecom_api_url.rstrip('/')}/openapi"
    
    try:
        logger.info("Warming up ecom API at %s", warmup_url)
        
        # Run the blocking requests call in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.get(warmup_url, timeout=30)
        )
        
        if response.status_code == 200:
            logger.info("Successfully warmed up ecom API - Status: %d", response.status_code)
        else:
            logger.warning("Ecom API warmup returned status %d", response.status_code)
            
    except requests.exceptions.RequestException as e:
        logger.warning("Failed to warm up ecom API: %s", str(e))
    except Exception as e:
        logger.error("Unexpected error during ecom API warmup: %s", str(e))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:  # pylint: disable=unused-argument
    try:
        # Startup: warm up the ecom API
        await warmup_ecom_api()
        yield
    finally:
        # ensure all sessions are cleaned up
        remaining = await session_manager.list_session_ids()
        await asyncio.gather(*[session_manager.remove_session(session_id) for session_id in remaining])


app = FastAPI(title="Azure Voice Live Avatar Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Mount static files (frontend build) when in production
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "voice-live-avatar-backend"}


@app.get("/api/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Get current configuration from config.py"""
    current_agent = agent_config.get_current_agent()
    
    if current_agent:
        return ConfigResponse(
            model=current_agent["model"],
            agent_name=current_agent["name"],
            instructions=current_agent["instructions"],
            agent_id=current_agent["agent_id"]
        )
    else:
        # Return default values if no agent is configured
        return ConfigResponse(
            model="gpt-4o-mini",
            agent_name="voice-agent",
            instructions="You are an AI Voice Assistant designed to have natural conversations with users.",
            agent_id=""
        )


@app.post("/api/config", response_model=AgentCreateResponse)
async def update_config(config: ConfigUpdate) -> AgentCreateResponse:
    """Create new agent and store in config.py"""
    try:
        # Check if agent already exists with same configuration
        existing_agent_id = agent_config.agent_exists(
            model=config.model,
            name=config.agent_name,
            instructions=config.instructions
        )
        
        if existing_agent_id:
            # Set this agent as current and return it
            agent_config.set_current_agent(existing_agent_id)
            logger.info(f"Agent already exists with same configuration: {existing_agent_id}")
            return AgentCreateResponse(
                agent_id=existing_agent_id,
                status="success",
                message=f"Using existing agent with ID: {existing_agent_id}"
            )
        
        # Create new agent
        logger.info(f"Creating new agent with configuration")
        agent_id = await create_azure_agent(
            model=config.model,
            name=config.agent_name,
            instructions=config.instructions
        )
        
        # Store agent in config.py (automatically sets as current)
        agent_config.add_agent(
            agent_id=agent_id,
            model=config.model,
            name=config.agent_name,
            instructions=config.instructions,
            set_as_current=True
        )
        
        logger.info(f"New agent created and saved to config: {agent_id}")
        
        return AgentCreateResponse(
            agent_id=agent_id,
            status="success",
            message=f"New agent created successfully with ID: {agent_id}"
        )
        
    except Exception as e:
        logger.error(f"Failed to create agent: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to create agent: {str(e)}"
        )


@app.get("/api/agents")
async def get_all_agents():
    """Get all stored agents"""
    try:
        agents = agent_config.get_all_agents()
        current_agent = agent_config.get_current_agent()
        current_id = current_agent["agent_id"] if current_agent else None
        
        return {
            "agents": agents,
            "current_agent_id": current_id,
            "total_count": len(agents)
        }
    except Exception as e:
        logger.error(f"Failed to get agents: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get agents: {str(e)}")


@app.post("/api/agents/{agent_id}/activate")
async def activate_agent(agent_id: str):
    """Set an agent as the current active agent"""
    try:
        success = agent_config.set_current_agent(agent_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
        
        return {
            "status": "success",
            "message": f"Agent {agent_id} is now active",
            "agent_id": agent_id
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to activate agent: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to activate agent: {str(e)}")


@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent from storage"""
    try:
        success = agent_config.delete_agent(agent_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
        
        return {
            "status": "success",
            "message": f"Agent {agent_id} deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete agent: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")


@app.post("/api/config/reload")
async def reload_config():
    """Reload configuration from environment variables"""
    # Reload .env file
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
    return {"status": "reloaded", "message": "Configuration reloaded successfully"}


@app.delete("/api/config/agent")
async def reset_agent():
    """Reset the current agent configuration (clears current selection)"""
    try:
        agent_config.clear_current_agent()
        logger.info("Agent configuration reset")
        return {"status": "success", "message": "Current agent selection has been cleared"}
        
    except Exception as e:
        logger.error(f"Failed to reset agent configuration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reset agent: {str(e)}")


@app.get("/api/config/status")
async def get_config_status():
    """Get the current configuration status"""
    current_agent = agent_config.get_current_agent()
    return {
        "has_agent": bool(current_agent),
        "agent_id": agent_id,
        "model": os.getenv("AGENT_MODEL", ""),
        "agent_name": os.getenv("AGENT_NAME", ""),
        "ready_for_session": bool(agent_id and os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING"))
    }


async def _ensure_session(session_id: str):
    try:
        return await session_manager.get_session(session_id)
    except KeyError as exc:  # pylint: disable=raise-missing-from
        raise HTTPException(status_code=404, detail="Session not found") from exc


@app.post("/api/session", response_model=SessionResponse)
async def create_session() -> SessionResponse:
    session = await session_manager.create_session()
    return SessionResponse(session_id=session.session_id)


@app.get("/api/session/{session_id}")
async def get_session_status(session_id: str):
    try:
        session = await session_manager.get_session(session_id)
        return {"session_id": session_id, "status": "active"}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")


@app.post("/api/session/{session_id}/avatar/disconnect")
async def disconnect_avatar(session_id: str):
    try:
        session = session_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
            
        await session.disconnect_avatar()
        return {"success": True, "message": "Avatar disconnected"}
        
    except Exception as e:
        logger.error("Avatar disconnect failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/session/{session_id}/avatar/connect")
async def handle_avatar_offer(session_id: str, request: AvatarOfferRequest) -> AvatarAnswerResponse:
    try:
        session = await _ensure_session(session_id)
        logger.info("[%s] Handling avatar connect request", session_id)
        server_sdp = await session.connect_avatar(request.client_sdp)
        logger.info("[%s] Avatar connect successful", session_id)
        return AvatarAnswerResponse(server_sdp=server_sdp)
    except RuntimeError as e:
        logger.error("[%s] Avatar connection failed: %s", session_id, str(e))
        raise HTTPException(status_code=500, detail=f"Avatar connection failed: {str(e)}")
    except Exception as e:
        logger.error("[%s] Unexpected avatar error: %s", session_id, str(e))
        raise HTTPException(status_code=500, detail="Avatar connection failed due to unexpected error")


@app.post("/api/session/{session_id}/message")
async def send_text_message(session_id: str, request: TextMessageRequest) -> Dict[str, str]:
    session = await _ensure_session(session_id)
    await session.send_user_message(request.text)
    return {"status": "queued"}


@app.post("/sessions/{session_id}/commit-audio", response_model=AudioCommitResponse)
async def commit_audio(session_id: str) -> AudioCommitResponse:
    session = await _ensure_session(session_id)
    await session.commit_audio()
    return AudioCommitResponse(status="committed")


@app.websocket("/api/ws/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        session = await _ensure_session(session_id)
    except HTTPException:
        await websocket.close(code=4404)
        return

    queue = session.create_event_queue()

    async def emitter():
        try:
            while True:
                event = await queue.get()
                await websocket.send_json(event)
        except WebSocketDisconnect:
            logger.info("Websocket emitter disconnect for session %s", session_id)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Emitter failed: %s", exc)

    emitter_task = asyncio.create_task(emitter())

    await websocket.send_json({"type": "session_ready", "session_id": session_id})

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            if msg_type == "audio_chunk":
                audio_data = message.get("audio")  # Frontend sends 'audio' field
                await session.send_audio_chunk(audio_data)
            elif msg_type == "commit_audio":
                await session.commit_audio()
            elif msg_type == "clear_audio":
                await session.clear_audio()
            elif msg_type == "user_text":
                await session.send_user_message(message.get("text", ""))
            elif msg_type == "request_response":
                await session.request_response()
            else:
                logger.warning("Unknown WS message type: %s", msg_type)
    except WebSocketDisconnect:
        logger.info("Client disconnected from session %s", session_id)
    finally:
        emitter_task.cancel()
        session.remove_event_queue(queue)


# Serve React app for any unmatched routes (SPA fallback)
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve the React SPA for any non-API routes"""
    static_dir = Path(__file__).parent.parent / "static"
    
    # If static files exist and this isn't an API call, serve index.html
    if static_dir.exists() and not full_path.startswith(("sessions", "ws", "health", "static")):
        index_file = static_dir / "index.html"
        if index_file.exists():
            # Warm up the ecom API when serving the main page to prevent cold start delays
            if full_path == "" or full_path == "index.html":
                asyncio.create_task(warmup_ecom_api())
            return FileResponse(index_file)
    
    # Fallback 404 for missing routes
    raise HTTPException(status_code=404, detail="Not found")