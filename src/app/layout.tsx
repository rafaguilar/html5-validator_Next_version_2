
import type {Metadata} from 'next';
import { Geist_Sans, Geist_Mono } from 'geist/font';
import './globals.css';
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { FirebaseProvider } from '@/components/firebase/firebase-provider';

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
      <body className={`${Geist_Sans.variable} ${Geist_Mono.variable} antialiased font-sans`}>
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
