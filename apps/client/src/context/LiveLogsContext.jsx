import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { queryKeys } from '../api/queryKeys';

const LiveLogsContext = createContext({
  logs: [],
  connectionStatus: 'connecting',
  clearLiveLogs: () => {},
});

export function LiveLogsProvider({ user, children }) {
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  useEffect(() => {
    if (!user?._id) {
      setLogs([]);
      setConnectionStatus('offline');
      return undefined;
    }

    const socket = io({ transports: ['websocket', 'polling'] });
    const joinUserRoom = () => socket.emit('join', user._id.toString());
    const goOffline = () => {
      setConnectionStatus('offline');
      setLogs([]);
    };

    socket.on('connect', () => {
      setConnectionStatus('connected');
      joinUserRoom();
    });
    socket.on('connect_error', goOffline);
    socket.io.on('reconnect_attempt', () => setConnectionStatus('connecting'));
    socket.io.on('reconnect', () => {
      setConnectionStatus('connected');
      joinUserRoom();
    });
    socket.io.on('reconnect_failed', goOffline);
    socket.on('disconnect', goOffline);
    socket.on('new_log', (entry) => {
      setLogs((prev) => [entry, ...prev]);
      queryClient.setQueryData(queryKeys.logs({ limit: 10 }), (current = []) => [entry, ...current].slice(0, 10));
      queryClient.invalidateQueries({ queryKey: queryKeys.status() });
      queryClient.invalidateQueries({ queryKey: queryKeys.modelDistribution() });
    });
    socket.on('logs_cleared', () => {
      setLogs([]);
      queryClient.setQueryData(queryKeys.logs({ limit: 10 }), []);
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.status() });
      queryClient.invalidateQueries({ queryKey: queryKeys.modelDistribution() });
    });

    return () => socket.disconnect();
  }, [queryClient, user?._id]);

  const value = useMemo(() => ({
    logs,
    connectionStatus,
    clearLiveLogs: () => setLogs([]),
  }), [connectionStatus, logs]);

  return (
    <LiveLogsContext.Provider value={value}>
      {children}
    </LiveLogsContext.Provider>
  );
}

export function useLiveLogs() {
  return useContext(LiveLogsContext);
}
