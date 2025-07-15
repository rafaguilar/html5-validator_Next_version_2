
"use client";

import React, { useState } from 'react';
import { AppHeader } from '@/components/layout/header';
import { Validator } from '@/components/html-validator/validator';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('validator');

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-grow container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto space-y-8">
          <Validator />
        </div>
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t bg-card">
        © {new Date().getFullYear()} HTML Validator. All rights reserved.
      </footer>
    </div>
  );
}
