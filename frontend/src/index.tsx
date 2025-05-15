import { render } from 'preact';
import { App } from './App';
import './style.css'; // Assuming you have or will create this

const appRoot = document.getElementById('app');

if (appRoot) {
    render(<App />, appRoot);
} else {
    console.error("Application root element '#app' not found.");
} 