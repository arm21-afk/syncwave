import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SyncWave — Together, on the same wavelength',
  description:
    'Your people. Your queue. One shared moment. Private synchronized YouTube watch parties.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
