# AI Eataly Chat

A ChatGPT-like web application built with React, Vite, TailwindCSS, and Firebase Firestore.

## Features

- 🎨 Modern, dark-mode UI similar to ChatGPT
- 💬 Real-time chat interface with message bubbles
- 🤖 Multiple AI model selection (GPT-4, GPT-4o, GPT-5, Llama 3 70B, Mistral Large)
- 📱 Responsive sidebar with conversation history
- ⚡ Fast and smooth transitions
- 🎯 State management with Zustand
- 🔥 Firebase Firestore integration for persistent chat storage
- ☁️ Real-time synchronization across devices

## Getting Started

### Installation

```bash
npm install
```

### Firebase Setup

**⚠️ Important:** Before running the app, you need to configure Firebase Firestore.

1. The Firebase configuration is already set up in `src/config/firebase.js`
2. Go to [Firebase Console](https://console.firebase.google.com/)
3. Select project: `eataly-creative-ai-suite`
4. Enable Firestore Database
5. Configure Firestore security rules (see `FIREBASE_SETUP.md` for details)

For detailed Firebase setup instructions, see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

## Project Structure

```
src/
  components/
    Sidebar.jsx          # Left sidebar with chat history
    ChatWindow.jsx       # Main chat interface
    MessageBubble.jsx    # Individual message component
    ModelSelector.jsx    # Model dropdown selector
    ChatInput.jsx        # Message input with auto-resize
  config/
    firebase.js          # Firebase configuration and initialization
  store/
    chatStore.js        # Zustand store with Firebase integration
  App.jsx               # Main app component
  main.jsx              # Entry point
  index.css             # Global styles with Tailwind
```

## Technologies

- React 18
- Vite
- TailwindCSS
- Zustand (state management)
- Firebase Firestore (database)
- Firebase SDK v9+

## Live Demo

🌐 **Live Site:** [https://giovannim-maker.github.io/ai-eataly-chat/](https://giovannim-maker.github.io/ai-eataly-chat/)

## Firebase Data Structure

The app stores chats in Firestore with the following structure:

```javascript
chats/{chatId}
  - title: string
  - messages: Array<{role: string, content: string, timestamp: string}>
  - model: string
  - createdAt: Timestamp
  - updatedAt: Timestamp
```

