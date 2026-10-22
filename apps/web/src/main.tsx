import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SetupPage } from './pages/SetupPage';
import { SessionPage } from './pages/SessionPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SetupPage />} />
          <Route path="/session/:id" element={<SessionPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" visibleToasts={3} richColors closeButton />
    </QueryClientProvider>
  </React.StrictMode>,
);
