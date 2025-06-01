# Mem0 Integration with Vercel Serverless Function

This document describes the steps taken to integrate the Mem0 AI SDK into a Vercel serverless function (`api/chat.js`), the issues encountered, and how to implement this integration in other projects.

---

## Overview

The goal was to add Mem0 AI memory storage capabilities to an existing Vercel serverless function that proxies requests to Fireworks AI. This allows conversations to be stored in Mem0 for future reference.

---

## Steps Taken

### 1. Mem0 SDK Integration

- Installed the `mem0ai` SDK in the project.
- Modified `api/chat.js` to:
  - Initialize the Mem0 client using the `MEM_API_KEY` environment variable.
  - After receiving a response from Fireworks AI, store the user message and AI response in Mem0 using `mem0.add()`.
  - Used `currentThreadId` as the `userId` for Mem0 to associate memories with conversation threads.
- Added error handling and logging for Mem0 operations.

### 2. Environment Variable Setup

- The `MEM_API_KEY` was initially set in a local `.env` file but **must also be set in the Vercel project environment variables** for the deployed function to access it.
- Used the Vercel CLI to add the `MEM_API_KEY` environment variable to the production environment of the Vercel project:
  ```bash
  vercel env add MEM_API_KEY production --scope <your-vercel-scope>
  ```
- Entered the API key value when prompted:
  ```
  m0-5soUff75IIRgmof4IZsqVBnT9JGNAoA63YAB0SfE
  ```
- This triggered an automatic redeployment of the project.

### 3. Deployment Configuration Fix

- The `vercel.json` file had `"version": 3`, which caused deployment errors.
- Changed `"version": 3` to `"version": 2` to comply with Vercel requirements for this project.
- Redeployed the project successfully.

### 4. Testing

- Sent a test POST request to the `/api/chat` endpoint with the correct Fireworks AI model:
  ```
  accounts/fireworks/models/qwen3-235b-a22b
  ```
- Verified that the API responded successfully.
- Confirmed that the Mem0 integration was working by checking the response and logs.

---

## Common Errors and How to Fix Them

- **Model Not Found Error:**
  - Ensure you use the correct model name as configured in your project.
  - Check your frontend or API code for the exact model string.

- **Environment Variable Not Set:**
  - The `MEM_API_KEY` must be set in the Vercel project environment variables, not just locally.
  - Use the Vercel dashboard or CLI to add it.

- **Deployment Errors Due to `vercel.json`:**
  - The `version` property must be `2` for this project setup.
  - Update `vercel.json` accordingly.

---

## How to Implement in Other Projects

1. **Install Mem0 SDK:**
   ```bash
   npm install mem0ai
   ```

2. **Modify Your Serverless Function:**
   - Import and initialize Mem0 client with your API key.
   - After processing AI responses, add conversation turns to Mem0.
   - Handle errors gracefully.

   Example code snippet for `api/chat.js`:

   ```javascript
   const { kv } = require('@vercel/kv');
   const { Mem0 } = require('mem0ai');

   module.exports = async (req, res) => {
     // ... your existing code ...

     // Initialize Mem0 Client
     const mem0ApiKey = process.env.MEM_API_KEY;
     if (!mem0ApiKey) {
       console.error('MEM_API_KEY environment variable not set');
       return res.status(500).json({ 
         error: 'Server configuration error',
         message: 'Mem0 API key not configured.' 
       });
     }
     const mem0 = new Mem0({ apiKey: mem0ApiKey });

     // After getting AI response (non-streaming example)
     const aiResponseContent = data.choices[0].message.content;
     const threadId = req.body.currentThreadId || 'unknown-thread';

     // Store conversation in Mem0
     try {
       await mem0.add([
         { role: "user", content: req.body.messages.slice(-1)[0].content },
         { role: "agent", content: aiResponseContent }
       ], { userId: threadId });
       console.log('Conversation turn stored in Mem0 for userId:', threadId);
     } catch (mem0Error) {
       console.error('Error storing conversation in Mem0:', mem0Error);
     }

     // ... rest of your code ...
   };
   ```

   For streaming responses, you'll need to handle Mem0 storage after the stream completes:

   ```javascript
   // Streaming response example
   if (stream) {
     // ... streaming setup code ...

     try {
       while (true) {
         const { done, value } = await reader.read();
         if (done) {
           // After stream completes, store the full conversation in Mem0
           const fullResponse = assembledResponse; // Your accumulated response
           try {
             await mem0.add([
               { role: "user", content: req.body.messages.slice(-1)[0].content },
               { role: "agent", content: fullResponse }
             ], { userId: req.body.currentThreadId || 'default-user' });
             console.log('Streaming conversation stored in Mem0');
           } catch (mem0Error) {
             console.error('Error storing streaming conversation in Mem0:', mem0Error);
           }
           break;
         }
         // ... rest of streaming code ...
       }
     } catch (error) {
       console.error('Streaming error:', error);
     }
   }
   ```

3. **Set Environment Variables:**
   - Add `MEM_API_KEY` to your deployment environment (e.g., Vercel project settings).

4. **Deploy and Test:**
   - Deploy your project.
   - Test with appropriate API calls.
   - Verify data is stored in Mem0.

---

## Additional Notes

- Always verify your deployment environment has the necessary environment variables.
- Use the correct AI model names as per your project configuration.
- Monitor deployment logs for errors.
- Mem0 integration can be extended to other AI models and platforms similarly.

---

If you need help adapting this integration to other projects, feel free to reach out.
