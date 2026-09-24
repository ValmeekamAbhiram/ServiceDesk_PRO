# ServiceDesk Pro — Deployment Guide

This guide covers deploying **ServiceDesk Pro** to **Render** and **Vercel**.

---

## Architecture Overview

- **Backend API (`server/`)**: Express, Mongoose, Socket.IO real-time channel, and SLA background worker. Deployed to **Render** as a persistent Node.js Web Service.
- **Frontend App (`client/`)**: Vite React SPA. Deployed to **Vercel** as a high-performance static frontend (or optionally on Render as a static site).
- **Database**: **MongoDB Atlas** (free or dedicated tier).

---

## 1. Database Setup (MongoDB Atlas)

1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Under **Network Access**, allow access from anywhere (`0.0.0.0/0`) or whitelist your Render outgoing IPs.
3. Under **Database Access**, create a database user and password.
4. Copy the connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.mongodb.net/servicedesk_pro?retryWrites=true&w=majority
   ```

---

## 2. Deploying Backend on Render

### Option A: Using the Render Blueprint (Recommended)
1. Push your repository to GitHub or GitLab.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New** $\rightarrow$ **Blueprint**.
3. Connect your repository. Render automatically reads [render.yaml](../render.yaml).
4. Fill in the required environment variables:
   - `MONGO_URI`: Your MongoDB Atlas URI.
   - `CLIENT_URL`: Your Vercel frontend URL (e.g. `https://your-app.vercel.app`).
5. Click **Apply**. Render will generate secure JWT secrets and deploy the service.

### Option B: Manual Web Service Creation
1. In Render Dashboard, click **New +** $\rightarrow$ **Web Service**.
2. Connect your repo.
3. Configure the service:
   - **Name**: `servicedesk-api`
   - **Root Directory**: Leave blank (monorepo root)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start --workspace server`
   - **Health Check Path**: `/api/health`
4. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `MONGO_URI`: `mongodb+srv://...`
   - `JWT_SECRET`: *(Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)*
   - `JWT_REFRESH_SECRET`: *(Generate a second, distinct secret)*
   - `SERVER_URL`: `https://servicedesk-api.onrender.com` (your Render URL)
   - `CLIENT_URL`: `https://your-project.vercel.app` (your Vercel URL)
   - `AI_PROVIDER`: `gemini` (or `heuristic` for offline classifier)
   - `GEMINI_API_KEY`: *(Optional: Google Gemini API key)*
   - `AI_MODEL`: `gemini-1.5-flash`

---

## 3. Deploying Frontend on Vercel

1. Log in to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New** $\rightarrow$ **Project**.
2. Import your GitHub repository.
3. In the project configuration:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (or `client` — both are pre-configured with [vercel.json](../vercel.json))
   - **Build Command**: `npm run build --workspace client` (default handled by `vercel.json`)
   - **Output Directory**: `client/dist` (default handled by `vercel.json`)
4. Under **Environment Variables**, add:
   - `VITE_API_URL`: Your Render backend URL (e.g. `https://servicedesk-api.onrender.com`)
5. Click **Deploy**.

Vercel will build the frontend and serve it with automatic SPA routing rewrites.

---

## 4. Full-Stack Single-Service on Render (Alternative)

If you prefer to host both frontend and backend on a single Render Web Service without Vercel:
1. Render Build Command: `npm install && npm run build`
2. Render Start Command: `npm run start --workspace server`
3. Express automatically detects and serves `client/dist` from the same domain on port `10000`.

---

## 5. First-Time Setup & Seeding

The very first user who registers on a clean database automatically receives the `ADMIN` role.

To seed demo data directly against your production or staging MongoDB:
```bash
MONGO_URI="mongodb+srv://..." SEED_PASSWORD="YourPassword!" npm run seed
```
