import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { router } from './router.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
