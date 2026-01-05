#!/usr/bin/env python3
"""
MS Console Server - FastAPI wrapper for MS Console with streaming support
Provides HTTP endpoints for Electron app communication with real-time streaming.

Changes from original msagent.py:
- Added FastAPI server wrapper for HTTP communication
- Implemented Server-Sent Events (SSE) for real-time token streaming
- Added separate endpoints for tool call events visualization
- Added health check and connection test endpoints
- Preserved all original tool functionality and safety constraints

Environment Variables:
    OPENAI_API_KEY      - Your OpenAI API key (required)
    MYSQL_HOST          - MySQL server hostname (default: queryms.ucsf.edu)
    MYSQL_PORT          - MySQL server port (default: 3306)
    MYSQL_USERNAME      - MySQL username (default: medcp)
    MYSQL_PASSWORD      - MySQL password (default: provided)
    MYSQL_DATABASE      - MySQL database name (default: imsms)
    OPENAI_MODEL        - OpenAI model to use (default: gpt-5.2)
    SERVER_PORT         - Server port (default: 8765)
"""

import json
import logging
import os
import re
import sys
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, AsyncGenerator
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

# Thread pool for running blocking OpenAI calls
executor = ThreadPoolExecutor(max_workers=4)

# FastAPI and async dependencies
try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse, JSONResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("Error: FastAPI dependencies are required.")
    print("Install with: pip install fastapi uvicorn pydantic")
    sys.exit(1)

try:
    import mysql.connector
    from mysql.connector import Error
except ImportError:
    print("Error: mysql-connector-python is required.")
    print("Install with: pip install mysql-connector-python")
    sys.exit(1)

try:
    from openai import OpenAI
except ImportError:
    print("Error: openai package is required.")
    print("Install with: pip install openai")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("MSConsoleServer")


# =============================================================================
# Configuration
# =============================================================================

def get_db_config() -> Dict[str, Any]:
    """Get database configuration from environment variables."""
    return {
        'host': os.getenv('MYSQL_HOST', 'queryms.ucsf.edu'),
        'port': int(os.getenv('MYSQL_PORT', '3306')),
        'user': os.getenv('MYSQL_USERNAME', 'medcp'),
        'password': os.getenv('MYSQL_PASSWORD', 'Medcp_aiqueries_123#@!'),
        'database': os.getenv('MYSQL_DATABASE', 'imsms'),
        'autocommit': True,
        'connection_timeout': 10,
        'auth_plugin': 'mysql_native_password'
    }


# =============================================================================
# OpenAI Tools Definition (preserved from original)
# =============================================================================

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": "List all tables in the MySQL database with their columns and data types. Returns comprehensive schema information including table structure, column names, data types, constraints, and relationships. Use this tool first to understand what data is available.",
            "parameters": {
                "type": "object",
                "properties": {
                    "database": {
                        "type": "string",
                        "description": "Database name to list tables from. If not specified, lists all accessible databases."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_query",
            "description": "Execute a READ-ONLY SQL query on the MySQL database for rapid clinical data retrieval. Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed for security and data integrity. Supports complex queries with joins, aggregations, and filtering.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "SQL SELECT query to execute. Only read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN) are allowed."
                    },
                    "database": {
                        "type": "string",
                        "description": "Database name to execute query against (optional, uses default if not specified)."
                    }
                },
                "required": ["query"]
            }
        }
    }
]


SYSTEM_PROMPT = """You are MS Console, an intelligent assistant for exploring and analyzing the UCSF Multiple Sclerosis Medical Database.

Your capabilities:
1. **list_tables**: Explore database structure, list tables, view columns and data types
2. **execute_query**: Run read-only SQL queries (SELECT, SHOW, DESCRIBE, EXPLAIN only)

Guidelines:
- Always start by exploring the database structure if you don't know what tables exist
- Write efficient SQL queries with appropriate LIMIT clauses for large datasets
- Explain your findings in a clear, medical-research-friendly manner
- Respect data privacy - never attempt to export or modify patient data
- When analyzing data, provide statistical context and medical relevance
- If a query fails, explain the error and suggest corrections

You are connected to a MySQL database containing Multiple Sclerosis clinical research data. Help researchers explore and analyze this data effectively while maintaining security and data integrity."""


# =============================================================================
# Database Functions (preserved from original)
# =============================================================================

class MSConsoleDB:
    """Database handler for MS Console."""
    
    def __init__(self):
        self.connection: Optional[mysql.connector.MySQLConnection] = None
        self.db_config = get_db_config()
    
    def _get_connection(self, database: Optional[str] = None) -> mysql.connector.MySQLConnection:
        """Get database connection, creating one if necessary."""
        try:
            if self.connection is None or not self.connection.is_connected():
                config = self.db_config.copy()
                if database:
                    config['database'] = database
                elif not config.get('database'):
                    config.pop('database', None)
                
                self.connection = mysql.connector.connect(**config)
                logger.info(f"Connected to MySQL at {config['host']}:{config['port']}")
            
            return self.connection
        except Error as e:
            logger.error(f"Database connection error: {e}")
            raise Exception(f"Database connection failed: {e}")
    
    def _is_read_only_query(self, query: str) -> bool:
        """Check if query is read-only. SECURITY: This constraint is preserved from original."""
        cleaned_query = re.sub(r'--.*?\n|/\*.*?\*/', '', query, flags=re.DOTALL)
        cleaned_query = re.sub(r'\s+', ' ', cleaned_query).strip().lower()
        
        read_only_patterns = [
            r'^select\s',
            r'^show\s',
            r'^describe\s',
            r'^desc\s',
            r'^explain\s',
            r'^with\s.*select\s'
        ]
        
        for pattern in read_only_patterns:
            if re.match(pattern, cleaned_query):
                return True
        
        return False
    
    def list_tables(self, database: Optional[str] = None) -> str:
        """List all tables and their structure."""
        try:
            connection = self._get_connection(database)
            cursor = connection.cursor()
            
            if not database:
                cursor.execute("SHOW DATABASES")
                databases = [db[0] for db in cursor.fetchall()]
                
                result = "📚 Available Databases:\n"
                result += "=" * 30 + "\n"
                for db in databases:
                    result += f"  • {db}\n"
                result += "\n💡 Tip: Specify a database name to see its tables.\n"
                cursor.close()
                return result
            
            cursor.execute(f"USE `{database}`")
            cursor.execute("SHOW TABLES")
            tables = [table[0] for table in cursor.fetchall()]
            
            if not tables:
                cursor.close()
                return f"No tables found in database '{database}'"
            
            result = f"📊 Tables in '{database}':\n"
            result += "=" * 40 + "\n\n"
            
            for table in tables:
                result += f"📋 {table}\n"
                result += "-" * (len(table) + 3) + "\n"
                
                cursor.execute(f"DESCRIBE `{table}`")
                columns = cursor.fetchall()
                
                for col in columns:
                    field, field_type, null, key, default, extra = col
                    line = f"   {field}: {field_type}"
                    if key == 'PRI':
                        line += " [PK]"
                    elif key == 'MUL':
                        line += " [FK]"
                    elif key == 'UNI':
                        line += " [UNIQUE]"
                    if null == "NO":
                        line += " NOT NULL"
                    result += line + "\n"
                
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                    count = cursor.fetchone()[0]
                    result += f"   📈 Rows: {count:,}\n"
                except:
                    pass
                
                result += "\n"
            
            cursor.close()
            return result
            
        except Error as e:
            logger.error(f"Error listing tables: {e}")
            return f"Error listing tables: {e}"
    
    def execute_query(self, query: str, database: Optional[str] = None) -> str:
        """Execute a read-only SQL query. SECURITY: Read-only constraint preserved."""
        try:
            if not self._is_read_only_query(query):
                return ("🚫 Security Error: Only read-only queries are allowed.\n"
                        "Permitted: SELECT, SHOW, DESCRIBE, EXPLAIN\n"
                        "Blocked: INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, etc.")
            
            connection = self._get_connection(database)
            cursor = connection.cursor()
            
            if database:
                cursor.execute(f"USE `{database}`")
            
            logger.info(f"Executing: {query[:100]}...")
            
            cursor.execute(query)
            results = cursor.fetchall()
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
            
            if not results:
                cursor.close()
                return f"✅ Query executed successfully.\n📊 Result: No rows returned."
            
            output = f"📊 Query Results ({len(results):,} rows)\n"
            output += "=" * 50 + "\n\n"
            
            widths = []
            for i, col in enumerate(column_names):
                max_width = len(str(col))
                for row in results[:100]:
                    cell = str(row[i]) if row[i] is not None else "NULL"
                    max_width = max(max_width, min(len(cell), 50))
                widths.append(min(max_width, 50))
            
            header = " | ".join(str(col)[:w].ljust(w) for col, w in zip(column_names, widths))
            output += header + "\n"
            output += "-" * len(header) + "\n"
            
            display_limit = 50
            for row in results[:display_limit]:
                row_str = " | ".join(
                    (str(cell) if cell is not None else "NULL")[:w].ljust(w) 
                    for cell, w in zip(row, widths)
                )
                output += row_str + "\n"
            
            if len(results) > display_limit:
                output += f"\n⚠️  Showing {display_limit} of {len(results):,} rows\n"
                output += "   Add LIMIT to your query for specific row counts.\n"
            
            output += f"\n📈 Total: {len(results):,} rows, {len(column_names)} columns\n"
            
            cursor.close()
            return output
            
        except Error as e:
            logger.error(f"Query error: {e}")
            return f"❌ Query Error: {e}\n\n💡 Tip: Use list_tables to check available tables and columns."
    
    def close(self):
        """Close database connection."""
        if self.connection and self.connection.is_connected():
            self.connection.close()
            logger.info("Database connection closed")


# =============================================================================
# Streaming Agent
# =============================================================================

class StreamingMSConsole:
    """OpenAI-powered agent with streaming support for MS database exploration."""
    
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.getenv('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError(
                "OpenAI API key required. Set OPENAI_API_KEY environment variable "
                "or pass api_key parameter."
            )
        
        self.client = OpenAI(api_key=self.api_key)
        self.model = model or os.getenv('OPENAI_MODEL', 'gpt-5.2')
        self.db = MSConsoleDB()
        
        logger.info(f"StreamingMSConsole initialized with model: {self.model}")
    
    def _execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool and return the result. Tool behavior preserved from original."""
        logger.info(f"Executing tool: {tool_name}")
        
        if tool_name == "list_tables":
            return self.db.list_tables(arguments.get("database"))
        elif tool_name == "execute_query":
            return self.db.execute_query(
                arguments["query"],
                arguments.get("database")
            )
        else:
            return f"Unknown tool: {tool_name}"
    
    async def chat_stream(
        self, 
        user_message: str, 
        conversation_history: List[Dict[str, Any]]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Process a user message and yield streaming events.
        Supports multiple consecutive tool calls in a loop until the model produces final text.
        
        Event types:
        - {"type": "token", "content": "..."} - Text token
        - {"type": "tool_call_start", "tool_name": "...", "tool_id": "...", "arguments": {...}}
        - {"type": "tool_call_end", "tool_id": "...", "result": "..."}
        - {"type": "done", "content": "..."} - Final complete message
        - {"type": "error", "message": "..."} - Error occurred
        """
        
        # Build messages list
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(conversation_history)
        messages.append({"role": "user", "content": user_message})
        
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        all_content = ""
        
        try:
            while iteration < max_iterations:
                iteration += 1
                logger.info(f"Tool call iteration {iteration}")
                
                # Run the OpenAI API call in a thread to avoid blocking
                loop = asyncio.get_event_loop()
                
                def make_openai_call():
                    return self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        tools=TOOLS,
                        tool_choice="auto",
                        stream=True
                    )
                
                response = await loop.run_in_executor(executor, make_openai_call)
                
                # Collect the response
                current_content = ""
                tool_calls_data = {}
                
                # Process chunks - run in executor to avoid blocking
                def process_chunks():
                    nonlocal current_content, tool_calls_data
                    chunks_data = []
                    for chunk in response:
                        delta = chunk.choices[0].delta if chunk.choices else None
                        if delta is None:
                            continue
                        
                        if delta.content:
                            current_content += delta.content
                            chunks_data.append({"type": "token", "content": delta.content})
                        
                        if delta.tool_calls:
                            for tc in delta.tool_calls:
                                idx = tc.index
                                if idx not in tool_calls_data:
                                    tool_calls_data[idx] = {"id": "", "name": "", "arguments": ""}
                                if tc.id:
                                    tool_calls_data[idx]["id"] = tc.id
                                if tc.function:
                                    if tc.function.name:
                                        tool_calls_data[idx]["name"] = tc.function.name
                                    if tc.function.arguments:
                                        tool_calls_data[idx]["arguments"] += tc.function.arguments
                    return chunks_data
                
                # Process chunks in thread and yield results
                chunks_data = await loop.run_in_executor(executor, process_chunks)
                
                for chunk_event in chunks_data:
                    all_content += chunk_event.get("content", "")
                    yield chunk_event
                    await asyncio.sleep(0)
                
                # If no tool calls, we're done
                if not tool_calls_data:
                    yield {"type": "done", "content": all_content}
                    return
                
                # Process tool calls
                assistant_tool_calls = []
                for idx in sorted(tool_calls_data.keys()):
                    tc_data = tool_calls_data[idx]
                    assistant_tool_calls.append({
                        "id": tc_data["id"],
                        "type": "function",
                        "function": {
                            "name": tc_data["name"],
                            "arguments": tc_data["arguments"]
                        }
                    })
                
                # Add assistant message with tool calls to messages
                messages.append({
                    "role": "assistant",
                    "content": current_content if current_content else None,
                    "tool_calls": assistant_tool_calls
                })
                
                # Execute each tool and stream results
                for idx in sorted(tool_calls_data.keys()):
                    tc_data = tool_calls_data[idx]
                    tool_name = tc_data["name"]
                    tool_id = tc_data["id"]
                    
                    try:
                        arguments = json.loads(tc_data["arguments"])
                    except json.JSONDecodeError:
                        arguments = {}
                    
                    # Emit tool call start
                    yield {
                        "type": "tool_call_start",
                        "tool_name": tool_name,
                        "tool_id": tool_id,
                        "arguments": arguments
                    }
                    await asyncio.sleep(0)
                    
                    # Execute tool in thread pool (capture variables properly)
                    def execute_tool(tn=tool_name, args=arguments):
                        return self._execute_tool(tn, args)
                    
                    result = await loop.run_in_executor(executor, execute_tool)
                    
                    # Add tool result to messages
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "content": result
                    })
                    
                    # Emit tool call end
                    yield {
                        "type": "tool_call_end",
                        "tool_id": tool_id,
                        "result": result
                    }
                    await asyncio.sleep(0)
                
                # Loop continues to next iteration for potential follow-up tool calls
            
            # If we reached max iterations, yield what we have
            yield {"type": "done", "content": all_content}
                
        except Exception as e:
            logger.error(f"Chat error: {e}")
            import traceback
            traceback.print_exc()
            yield {"type": "error", "message": str(e)}
    
    def close(self):
        """Clean up resources."""
        self.db.close()


# =============================================================================
# FastAPI Application
# =============================================================================

app = FastAPI(
    title="MS Console Server",
    description="OpenAI-powered agent for UCSF MS Database exploration",
    version="1.0.0"
)

# CORS for Electron - allow all origins without credentials for simplicity
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Set to False when using wildcard origins
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Global agent instance
agent: Optional[StreamingMSConsole] = None


class ChatRequest(BaseModel):
    message: str
    conversation_history: List[Dict[str, Any]] = []
    model: Optional[str] = None


class ConversationMessage(BaseModel):
    role: str
    content: str


# Explicit OPTIONS handler for preflight requests
@app.options("/chat/stream")
async def chat_stream_options():
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@app.on_event("startup")
async def startup_event():
    """Initialize agent on server startup."""
    global agent
    try:
        api_key = os.getenv('OPENAI_API_KEY')
        model = os.getenv('OPENAI_MODEL', 'gpt-5.2')
        if api_key:
            agent = StreamingMSConsole(api_key=api_key, model=model)
            logger.info("MS Console initialized successfully")
        else:
            logger.warning("No OPENAI_API_KEY set, agent not initialized")
    except Exception as e:
        logger.error(f"Failed to initialize agent: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on server shutdown."""
    global agent
    if agent:
        agent.close()


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"Response status: {response.status_code}")
    return response


@app.get("/ping")
async def ping():
    """Simple ping endpoint for testing connectivity."""
    return {"status": "pong", "timestamp": datetime.now().isoformat()}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "agent_ready": agent is not None
    }


@app.post("/test-connection")
async def test_connection():
    """Test OpenAI and database connections."""
    global agent
    
    results = {
        "openai": {"success": False, "message": ""},
        "database": {"success": False, "message": ""}
    }
    
    # Test OpenAI
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        results["openai"]["message"] = "No API key configured"
    else:
        try:
            client = OpenAI(api_key=api_key)
            # Simple test call - use max_completion_tokens for newer models
            response = client.chat.completions.create(
                model=os.getenv('OPENAI_MODEL', 'gpt-5.2'),
                messages=[{"role": "user", "content": "Hi"}],
                max_completion_tokens=5
            )
            results["openai"]["success"] = True
            results["openai"]["message"] = "Connected successfully"
        except Exception as e:
            results["openai"]["message"] = str(e)
    
    # Test Database
    try:
        db = MSConsoleDB()
        db._get_connection()
        results["database"]["success"] = True
        results["database"]["message"] = "Connected successfully"
        db.close()
    except Exception as e:
        results["database"]["message"] = str(e)
    
    return {
        "success": results["openai"]["success"] and results["database"]["success"],
        "results": results
    }


@app.post("/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """
    Stream chat response with Server-Sent Events.
    Returns a stream of JSON events.
    """
    global agent
    
    logger.info(f"Received chat request: {request.message[:50]}...")
    
    if not agent:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            logger.error("No API key configured")
            return JSONResponse(
                status_code=400,
                content={"error": "OpenAI API key not configured"}
            )
        try:
            model = request.model or os.getenv('OPENAI_MODEL', 'gpt-5.2')
            agent = StreamingMSConsole(api_key=api_key, model=model)
            logger.info(f"Agent initialized with model: {model}")
        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")
            return JSONResponse(
                status_code=500,
                content={"error": f"Failed to initialize agent: {str(e)}"}
            )
    
    # Update model if specified
    if request.model and request.model != agent.model:
        agent.model = request.model
        logger.info(f"Updated model to: {request.model}")
    
    async def event_generator():
        try:
            async for event in agent.chat_stream(
                request.message,
                request.conversation_history
            ):
                data = f"data: {json.dumps(event)}\n\n"
                logger.debug(f"Yielding event: {event.get('type')}")
                yield data
        except Exception as e:
            logger.error(f"Stream error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Access-Control-Allow-Origin": "*",
        }
    )


@app.post("/chat")
async def chat_sync(request: ChatRequest):
    """
    Non-streaming chat endpoint (fallback).
    Returns complete response at once.
    """
    global agent
    
    if not agent:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise HTTPException(status_code=400, detail="OpenAI API key not configured")
        try:
            model = request.model or os.getenv('OPENAI_MODEL', 'gpt-5.2')
            agent = StreamingMSConsole(api_key=api_key, model=model)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to initialize agent: {str(e)}")
    
    if request.model and request.model != agent.model:
        agent.model = request.model
    
    # Collect all events
    full_content = ""
    tool_calls = []
    
    async for event in agent.chat_stream(request.message, request.conversation_history):
        if event["type"] == "token":
            full_content += event["content"]
        elif event["type"] == "tool_call_start":
            tool_calls.append({
                "name": event["tool_name"],
                "arguments": event["arguments"],
                "result": None
            })
        elif event["type"] == "tool_call_end":
            for tc in tool_calls:
                if tc["result"] is None:
                    tc["result"] = event["result"]
                    break
        elif event["type"] == "error":
            raise HTTPException(status_code=500, detail=event["message"])
    
    return {
        "content": full_content,
        "tool_calls": tool_calls
    }


@app.get("/models")
async def list_models():
    """List available OpenAI models."""
    return {
        "models": [
            {"id": "gpt-5.2", "name": "GPT-4.1"},
            {"id": "gpt-4o", "name": "GPT-4o"},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
            {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
            {"id": "gpt-3.5-turbo", "name": "GPT-3.5 Turbo"},
        ],
        "default": "gpt-5.2"
    }


@app.get("/tools")
async def list_tools():
    """List available tools."""
    return {"tools": TOOLS}


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    port = int(os.getenv('SERVER_PORT', '8765'))
    
    print(f"""
╔═══════════════════════════════════════════════════════════════════╗
║                    MS Console Server v1.0.0                       ║
║           UCSF Multiple Sclerosis Database Explorer               ║
╚═══════════════════════════════════════════════════════════════════╝

🚀 Starting server on port {port}...
    """)
    
    uvicorn.run(
        "msconsole_server:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )
