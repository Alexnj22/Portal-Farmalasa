// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { inject } from '@vercel/analytics';

import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext"; 

inject();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);