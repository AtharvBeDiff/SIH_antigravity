import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { MetaResponse, District } from './types';

interface AppStateContextType {
  meta: MetaResponse | null;
  districts: District[];
  selectedDistrict: string;
  setSelectedDistrict: (id: string) => void;
  loading: boolean;
  error: string | null;
  refreshMeta: () => Promise<void>;
  isOnline: boolean;
}

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [districts, setDistricts] = useState<District[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const refreshMeta = async () => {
    try {
      setLoading(true);
      const data = await api.meta.get();
      setMeta(data);
      setDistricts(data.districts || []);
      if (!selectedDistrict && data.districts && data.districts.length > 0) {
        setSelectedDistrict(data.districts[0].id);
      }
      setError(null);
    } catch (err: any) {
      console.error('Failed to load metadata:', err);
      setError(err.message || 'Failed to connect to backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMeta();
  }, []);

  return (
    <AppStateContext.Provider
      value={{
        meta,
        districts,
        selectedDistrict,
        setSelectedDistrict,
        loading,
        error,
        refreshMeta,
        isOnline,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
}
