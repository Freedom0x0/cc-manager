import React from 'react';
import { createRoot } from 'react-dom/client';
import { PetWindow } from './modules/pet/PetWindow';
import './global.d';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetWindow />
  </React.StrictMode>
);