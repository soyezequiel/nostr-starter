import Navbar from '@/components/Navbar';
import Profile from '@/components/Profile';

export default function ProfilePage() {
  return (
    <main className="min-h-[100dvh] bg-lc-black lc-grid-bg">
      <Navbar />
      <Profile />
    </main>
  );
}
