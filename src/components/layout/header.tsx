import { ShieldCheck } from 'lucide-react';

export function AppHeader() {
  return (
    <header className="bg-card border-b shadow-sm">
      <div className="container mx-auto px-4 py-4 flex items-center">
        <ShieldCheck className="h-8 w-8 text-primary mr-3" />
        <h1 className="text-2xl font-semibold text-foreground">
          HTML Validator
        </h1>
      </div>
    </header>
  );
}
