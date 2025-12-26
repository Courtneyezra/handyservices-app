import { useState, useCallback, createContext, useContext } from 'react';

type ClientNameContextType = {
  clientName: string;
  setClientName: (name: string) => void;
};

export const ClientNameContext = createContext<ClientNameContextType>({
  clientName: 'your client',
  setClientName: () => {},
});

export function useClientName() {
  return useContext(ClientNameContext);
}

export function useClientNameState() {
  const [clientName, setClientNameState] = useState<string>('your client');

  const setClientName = useCallback((fullName: string) => {
    if (!fullName) {
      setClientNameState('your client');
      return;
    }
    
    const firstName = fullName.split(' ')[0];
    setClientNameState(firstName);
  }, []);

  return { clientName, setClientName };
}
