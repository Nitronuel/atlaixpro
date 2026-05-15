// React root bootstrap for the Atlaix browser application.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const applyInterfaceDensity = () => {
    if (typeof window === 'undefined') return;

    const isLaptopViewport = window.innerWidth >= 1024;
    const isHighDisplayScale = window.devicePixelRatio >= 1.45;
    const isNarrowMobileViewport = window.innerWidth <= 430;
    const isHighDensityMobile = window.devicePixelRatio >= 1.75;

    document.documentElement.classList.toggle('atlaix-compact-ui', isLaptopViewport && isHighDisplayScale);
    document.documentElement.classList.toggle('atlaix-mobile-compact', isNarrowMobileViewport && isHighDensityMobile);
};

applyInterfaceDensity();
window.addEventListener('resize', applyInterfaceDensity);

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
