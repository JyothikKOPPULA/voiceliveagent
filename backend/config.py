"""
Configuration management for Voice Live Agent.
Stores all created agents in a JSON file instead of .env
"""

import json
import os
from pathlib import Path
from typing import Dict, Optional, List
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class AgentConfig:
    """Manages agent configurations stored in a JSON file."""
    
    def __init__(self, config_file: str = "agents_config.json"):
        """Initialize the agent config manager."""
        self.config_path = Path(__file__).resolve().parent / config_file
        self._ensure_config_file()
    
    def _ensure_config_file(self) -> None:
        """Ensure the config file exists."""
        if not self.config_path.exists():
            initial_config = {
                "agents": {},
                "current_agent_id": None,
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "last_updated": datetime.now().isoformat()
                }
            }
            self._save_config(initial_config)
            logger.info(f"Created new config file at {self.config_path}")
    
    def _load_config(self) -> Dict:
        """Load configuration from JSON file."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return {
                "agents": {},
                "current_agent_id": None,
                "metadata": {
                    "created_at": datetime.now().isoformat(),
                    "last_updated": datetime.now().isoformat()
                }
            }
    
    def _save_config(self, config: Dict) -> None:
        """Save configuration to JSON file."""
        try:
            # Update metadata
            config["metadata"]["last_updated"] = datetime.now().isoformat()
            
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            logger.info("Config saved successfully")
        except Exception as e:
            logger.error(f"Failed to save config: {e}")
            raise
    
    def add_agent(
        self, 
        agent_id: str, 
        model: str, 
        name: str, 
        instructions: str,
        set_as_current: bool = True
    ) -> None:
        """
        Add a new agent to the configuration.
        
        Args:
            agent_id: The Azure agent ID
            model: The model name (e.g., gpt-4o-mini)
            name: The agent name
            instructions: The agent instructions
            set_as_current: Whether to set this as the current active agent
        """
        config = self._load_config()
        
        # Add agent to the agents dictionary
        config["agents"][agent_id] = {
            "agent_id": agent_id,
            "model": model,
            "name": name,
            "instructions": instructions,
            "created_at": datetime.now().isoformat(),
            "last_used": datetime.now().isoformat()
        }
        
        # Set as current agent if requested
        if set_as_current:
            config["current_agent_id"] = agent_id
        
        self._save_config(config)
        logger.info(f"Added agent {agent_id} with name '{name}'")
    
    def get_agent(self, agent_id: str) -> Optional[Dict]:
        """Get agent details by ID."""
        config = self._load_config()
        return config["agents"].get(agent_id)
    
    def get_current_agent(self) -> Optional[Dict]:
        """Get the currently active agent."""
        config = self._load_config()
        current_id = config.get("current_agent_id")
        
        if current_id:
            agent = config["agents"].get(current_id)
            if agent:
                # Update last_used timestamp
                agent["last_used"] = datetime.now().isoformat()
                self._save_config(config)
            return agent
        return None
    
    def set_current_agent(self, agent_id: str) -> bool:
        """
        Set an agent as the current active agent.
        
        Returns:
            True if successful, False if agent not found
        """
        config = self._load_config()
        
        if agent_id not in config["agents"]:
            logger.error(f"Agent {agent_id} not found")
            return False
        
        config["current_agent_id"] = agent_id
        
        # Update last_used timestamp
        config["agents"][agent_id]["last_used"] = datetime.now().isoformat()
        
        self._save_config(config)
        logger.info(f"Set current agent to {agent_id}")
        return True
    
    def get_all_agents(self) -> List[Dict]:
        """Get all stored agents."""
        config = self._load_config()
        return list(config["agents"].values())
    
    def update_agent(
        self, 
        agent_id: str, 
        model: Optional[str] = None,
        name: Optional[str] = None,
        instructions: Optional[str] = None
    ) -> bool:
        """
        Update an existing agent's configuration.
        
        Returns:
            True if successful, False if agent not found
        """
        config = self._load_config()
        
        if agent_id not in config["agents"]:
            logger.error(f"Agent {agent_id} not found")
            return False
        
        agent = config["agents"][agent_id]
        
        if model is not None:
            agent["model"] = model
        if name is not None:
            agent["name"] = name
        if instructions is not None:
            agent["instructions"] = instructions
        
        agent["last_updated"] = datetime.now().isoformat()
        
        self._save_config(config)
        logger.info(f"Updated agent {agent_id}")
        return True
    
    def delete_agent(self, agent_id: str) -> bool:
        """
        Delete an agent from the configuration.
        
        Returns:
            True if successful, False if agent not found
        """
        config = self._load_config()
        
        if agent_id not in config["agents"]:
            logger.error(f"Agent {agent_id} not found")
            return False
        
        del config["agents"][agent_id]
        
        # Clear current_agent_id if this was the current agent
        if config.get("current_agent_id") == agent_id:
            config["current_agent_id"] = None
        
        self._save_config(config)
        logger.info(f"Deleted agent {agent_id}")
        return True
    
    def clear_current_agent(self) -> None:
        """Clear the current agent selection."""
        config = self._load_config()
        config["current_agent_id"] = None
        self._save_config(config)
        logger.info("Cleared current agent")
    
    def agent_exists(self, model: str, name: str, instructions: str) -> Optional[str]:
        """
        Check if an agent with the same configuration already exists.
        
        Returns:
            The agent_id if found, None otherwise
        """
        config = self._load_config()
        
        for agent_id, agent in config["agents"].items():
            if (agent["model"] == model and 
                agent["name"] == name and 
                agent["instructions"] == instructions):
                return agent_id
        
        return None


# Global instance
agent_config = AgentConfig()
