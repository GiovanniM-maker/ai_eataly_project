import ChatUI from './components/ChatUI';
import ChatSidebar from './components/ChatSidebar';

export default function App() {
  return (
    <div className="flex h-screen bg-gray-950">
      <ChatSidebar />
      <ChatUI />
    </div>
  );
}

