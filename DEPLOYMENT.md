# Vercel Deployment Guide for AI Bridge

## Quick Deploy

### Option 1: Deploy to Vercel (Recommended)

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```
   - Follow the prompts
   - For "Root Directory", enter: `.` (current directory)

4. **Set Environment Variables** in Vercel Dashboard:
   - Go to your project settings → Environment Variables
   - Add these variables (same as your `.env` file):
     - `MONGODB_URI` - Your MongoDB connection string
     - `GOOGLE_CLIENT_ID` - Your Google OAuth client ID
     - `GOOGLE_CLIENT_SECRET` - Your Google OAuth client secret
     - `GOOGLE_CALLBACK_URL` - Set to `https://your-app.vercel.app/auth/google/callback`
     - `SESSION_SECRET` - A random secret string (generate one)
     - `NODE_ENV` - `production`

5. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

### Option 2: Deploy via Git (GitHub/GitLab/Bitbucket)

1. Push your code to a Git repository
2. Connect your repository to Vercel at https://vercel.com/new
3. Vercel will automatically detect and deploy
4. Add environment variables in the Vercel dashboard

## Important Notes

### OAuth Callback URLs

After deployment, update your Google OAuth settings:
- **Callback URL**: `https://your-app-name.vercel.app/auth/google/callback`
- Update this in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

### MongoDB Connection

Your MongoDB URI is already configured for a cloud database (MongoDB Atlas), which works great with Vercel.

### Socket.IO Considerations

Vercel's serverless functions are ephemeral. Socket.IO may not work reliably for real-time features. For production:
- Consider using a separate WebSocket server on a platform like Railway, Render, or Heroku
- Or use Vercel's Edge Functions with WebSocket support (requires additional setup)

### Session Configuration

For production, consider using a persistent session store (like Redis) instead of in-memory sessions.

## Environment Variables Checklist

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL | Yes |
| `SESSION_SECRET` | Secret for session encryption | Yes |
| `NODE_ENV` | Environment (production) | Yes |
| `PORT` | Port (auto-set by Vercel) | No |
| `HOST` | Host binding | No |

## Troubleshooting

### 500 Error on Deploy
- Check Vercel deployment logs
- Verify all environment variables are set
- Ensure MongoDB URI is correct and accessible

### OAuth Not Working
- Verify callback URL matches exactly in Google Cloud Console
- Check `GOOGLE_CALLBACK_URL` env var matches your Vercel domain

### Socket.IO Not Connecting
- Vercel serverless functions don't maintain persistent connections
- Consider alternative real-time solutions or separate WebSocket server

## Local Development with Vercel

To test Vercel deployment locally:
```bash
vercel dev
```

This runs your app locally using Vercel's runtime.
