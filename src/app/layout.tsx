
import type {Metadata} from 'next';
import { Geist_Sans, Geist_Mono } from 'next/font/local';
import './globals.css';
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseProvider } from '@/components/firebase/firebase-provider';

const geistSans = Geist_Sans({
  variable: '--font-geist-sans',
  src: '../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  src: '../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2',
});

export const metadata: Metadata = {
  title: 'HTML Validator',
  description: 'Validate HTML5 creative assets against DCM specifications.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning={true}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}>
        <FirebaseProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </FirebaseProvider>
        {/* 100% privacy-first analytics */}
        <script data-collect-dnt="true" async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
        <noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif?collect-dnt=true" alt="" referrerPolicy="no-referrer-when-downgrade"/></noscript>
      </body>
    </html>
  );
}
