// home.js

const radiusSlider = document.getElementById('radiusSlider');
const radiusLabel = document.getElementById('radius-val');

const limitSlider = document.getElementById('limitSlider');
const limitLabel = document.getElementById('limit-val');

const btn = document.getElementById('startBtn');

// Update radius label
radiusSlider.addEventListener('input', (e) => {
    radiusLabel.innerText = e.target.value + " miles";
});

// Update limit label
limitSlider.addEventListener('input', (e) => {
    limitLabel.innerText = e.target.value + " items";
});

// Pass both values to dashboard
btn.addEventListener('click', () => {
    const radius = radiusSlider.value;
    const limit = limitSlider.value;
    // adding limit param to url
    window.location.href = `dashboard.html?radius=${radius}&limit=${limit}`;
});