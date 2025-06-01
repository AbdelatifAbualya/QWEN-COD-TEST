const { kv } = require('@vercel/kv');
const { Mem0 } = require('mem0ai');

module.exports = async (req, res) => {
  // Handle CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests for the main functionality
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Function to parse reflections from AI output text
  function parseReflectionsFromAIOutput(aiOutput) {
    const reflections = [];
    const detailedReflectionRegex = /DETAILED REFLECTION\s*\d+\s*:([\s\S]*?)(?=DETAILED REFLECTION\s*\d+\s*:|Reflection:|####|$)/gi;
    const briefReflectionRegex = /Reflection:([\s\S]*?)(?=####|$)/gi;
    let match;

    while ((match = detailedReflectionRegex.exec(aiOutput)) !== null) {
      reflections.push({ type: match[0].split(':')[0].trim(), content: match[1].trim() });
    }
    if ((match = briefReflectionRegex.exec(aiOutput)) !== null) {
      reflections.push({ type: 'BRIEF REFLECTION', content: match[1].trim() });
    }
    return reflections;
  }

  try {
    // Get Fireworks API key from environment variables
    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) {
      console.error('FIREWORKS_API_KEY environment variable not set');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'API key not configured. Please check server environment variables.' 
      });
    }

    // Initialize Mem0 Client
    const mem0ApiKey = process.env.MEM_API_KEY;
    if (!mem0ApiKey) {
      console.error('MEM_API_KEY environment variable not set');
      // Decide if this is a fatal error or if Mem0 is optional
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'Mem0 API key not configured.' 
      });
    }
    const mem0 = new Mem0({ apiKey: mem0ApiKey });

    // Extract the request body
    const { model, messages, temperature, top_p, top_k, max_tokens, presence_penalty, frequency_penalty, stream, tools, tool_choice, currentThreadId } = req.body;

    // Validate required fields
    if (!model || !messages) {
      console.error('Missing required fields in request:', { model: !!model, messages: !!messages });
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Missing required fields: model and messages' 
      });
    }

    console.log('Processing request:', { 
      model, 
      messageCount: messages.length, 
      stream: !!stream,
      toolsEnabled: !!(tools && tools.length > 0)
    });

    // Prepare the request to Fireworks API
    const fireworksPayload = {
      model,
      messages,
      temperature: temperature || 0.6,
      top_p: top_p || 1,
      top_k: top_k || 40,
      max_tokens: max_tokens || 4096,
      presence_penalty: presence_penalty || 0,
      frequency_penalty: frequency_penalty || 0,
      stream: stream || false
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      fireworksPayload.tools = tools;
      if (tool_choice) {
        fireworksPayload.tool_choice = tool_choice;
      }
    }

    const fireworksHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    // Handle streaming responses
    if (stream) {
      fireworksHeaders['Accept'] = 'text/event-stream';
      
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fireworks API Error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'API request failed',
          message: errorText 
        });
      }

      // Set headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (!response.body) {
        return res.status(500).json({ error: 'No response body from API' });
      }

      // Handle streaming with proper async iteration
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        res.end();
      } catch (error) {
        console.error('Streaming error:', error);
        res.write(`data: {"error": "Streaming interrupted"}\n\n`);
        res.end();
      }

    } else {
      // Handle non-streaming responses
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: fireworksHeaders,
        body: JSON.stringify(fireworksPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fireworks API Error:', response.status, errorText);
        return res.status(response.status).json({ 
          error: 'API request failed',
          message: errorText 
        });
      }

      const data = await response.json();

      // Extract AI response content string for reflection parsing
      // Assuming the AI response text is in data.choices[0].message.content
      const aiResponseContent = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '';

      // Use threadId from request or default
      const threadId = currentThreadId || 'unknown-thread';

      // Parse reflections from AI response content
      const reflections = parseReflectionsFromAIOutput(aiResponseContent);

      // Store each reflection in Vercel KV
      for (const reflection of reflections) {
        const reflectionId = `reflection:${threadId}:${new Date().toISOString()}:${Math.random().toString(36).substr(2, 9)}`;
        try {
          await kv.set(reflectionId, {
            threadId,
            timestamp: new Date().toISOString(),
            type: reflection.type,
            content: reflection.content
          });
          console.log('Reflection stored in KV:', reflectionId);
        } catch (error) {
          console.error('Error storing reflection in KV:', error);
          // Continue without failing the request
        }
      }

      // Store conversation in Mem0 for non-streaming responses
      const userMessageForMem0 = messages[messages.length - 1].content; // Assuming last message is user's
      const agentResponseForMem0 = aiResponseContent;
      
      if (userMessageForMem0 && agentResponseForMem0) {
        try {
          await mem0.add([
            { role: "user", content: userMessageForMem0 },
            { role: "agent", content: agentResponseForMem0 }
          ], { userId: currentThreadId || 'default-user' }); // Use currentThreadId as userId
          console.log('Conversation turn stored in Mem0 for userId:', currentThreadId || 'default-user');
        } catch (mem0Error) {
          console.error('Error storing conversation in Mem0:', mem0Error);
          // Do not fail the main response for this, just log it.
        }
      }

      return res.status(200).json(data);
    }

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
