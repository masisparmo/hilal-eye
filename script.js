let currentFullResult = null;
let currentRecapData = null;

const INDO_DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const HIST_SINGLE_KEY = 'hilal_eye_hist_single';
const HIST_RECAP_KEY = 'hilal_eye_hist_recap';

let obsPicker, recapPicker;

document.addEventListener('DOMContentLoaded', () => {
    // Populate City List
    const cityListId = document.getElementById('city-list');
    if (typeof CITIES !== 'undefined') {
        CITIES.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city.name;
            cityListId.appendChild(opt);
        });
    }

    const config = {
        dateFormat: "d/m/Y",
        allowInput: true,
        disableMobile: true,
        onChange: function(selectedDates, dateStr, instance) {
            const inputId = instance.element.id;
            const labelId = inputId === 'obs-date' ? 'obs-day-name' : 'recap-day-name';
            if (selectedDates.length > 0) {
                document.getElementById(labelId).textContent = INDO_DAYS[selectedDates[0].getDay()];
            }
        }
    };

    obsPicker = flatpickr("#obs-date", { ...config, defaultDate: "19/03/2026" });
    recapPicker = flatpickr("#recap-date", { ...config, defaultDate: "19/03/2026" });
    
    updateDayLabelManual('obs-date', 'obs-day-name');
    updateDayLabelManual('recap-date', 'recap-day-name');

    refreshHistoryList('single');
    refreshHistoryList('recap');
});

function updateDayLabelManual(inputId, labelId) {
    const picker = inputId === 'obs-date' ? obsPicker : recapPicker;
    if (picker && picker.selectedDates.length > 0) {
        document.getElementById(labelId).textContent = INDO_DAYS[picker.selectedDates[0].getDay()];
    }
}

function getISODate(picker) {
    if (!picker || picker.selectedDates.length === 0) return null;
    const d = picker.selectedDates[0];
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function switchTab(tabId, element) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if (element) {
        element.classList.add('active');
    }
}

// --- ASTRONOMY LOGIC (Replace Flask/Skyfield) ---
function calculateHilalJS(cityName, dateIsoStr) {
    const city = typeof CITIES !== 'undefined' ? CITIES.find(c => c.name.toLowerCase() === cityName.toLowerCase()) : null;
    if (!city) return { error: "Kota tidak ditemukan di database." };

    const lat = city.lat;
    const lon = city.lon;
    const elevation = city.elevation;
    
    // Convert to UTC by forcing hour to 12 local time (WIB roughly)
    const d = new Date(`${dateIsoStr}T12:00:00+07:00`);
    
    // Get sunset
    const times = SunCalc.getTimes(d, lat, lon, elevation);
    const sunset = times.sunset;
    
    if (isNaN(sunset)) return { error: "Matahari tidak terbenam hari ini di lokasi tersebut." };
    
    // Sun position at sunset
    const sunPos = SunCalc.getPosition(sunset, lat, lon);
    const sunAlt = sunPos.altitude * 180 / Math.PI;
    const sunAz = (sunPos.azimuth * 180 / Math.PI) + 180;
    
    // Moon position at sunset
    const moonPos = SunCalc.getMoonPosition(sunset, lat, lon);
    const moonAlt = moonPos.altitude * 180 / Math.PI;
    const moonAz = (moonPos.azimuth * 180 / Math.PI) + 180;
    
    const moonTimes = SunCalc.getMoonTimes(d, lat, lon);
    const moonset = moonTimes.set;
    
    // Angular Elongation
    const dAz = (moonPos.azimuth - sunPos.azimuth);
    const elongasiRad = Math.acos( Math.sin(sunPos.altitude)*Math.sin(moonPos.altitude) + Math.cos(sunPos.altitude)*Math.cos(moonPos.altitude)*Math.cos(dAz) );
    const elongasi = elongasiRad * 180 / Math.PI;
    
    const lagTime = (moonset && moonset > sunset) ? (moonset - sunset) / 60000 : 0;
    
    // Moon Age at sunset
    const illum = SunCalc.getMoonIllumination(sunset);
    const moonAgeHours = (illum.phase * 29.530589 * 24);
    
    let mabims = "Tidak Memenuhi";
    if (moonAlt >= 3.0 && elongasi >= 6.4) mabims = "Ya (Terpenuhi)";
    
    let danjon = elongasi < 7.0 ? "Tidak (Di bawah Limit Danjon)" : "Ya (Di atas Limit)";
    
    let odeh = "Invisible";
    let w_calc = moonAlt - (0.019 * elongasi * elongasi) + (0.47 * elongasi) - 1.5;
    if (w_calc > 7.16) odeh = "A (Mudah Terlihat)";
    else if (w_calc >= 0) odeh = "B (Mungkin Terlihat)";
    else if (w_calc > -3) odeh = "C (Butuh Alat Optik)";
    else if (w_calc > -4.5) odeh = "D (Sangat Sulit)";
    
    const df = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute:'2-digit', second:'2-digit', timeZoneName: 'short' });
    
    return {
        "Lokasi": city.name,
        "Tanggal": dateIsoStr,
        "Sunset": df.format(sunset),
        "Azimuth Matahari": sunAz.toFixed(3),
        "Altitude Matahari": sunAlt.toFixed(3),
        "Moonset": moonset ? df.format(moonset) : "Tidak Set",
        "Azimuth Bulan": moonAz.toFixed(3),
        "Altitude Hilal": moonAlt.toFixed(3),
        "Elongasi": elongasi.toFixed(3),
        "Umur Bulan (Jam)": moonAgeHours.toFixed(1),
        "Lag Time (Menit)": lagTime.toFixed(1),
        "MABIMS": mabims,
        "Odeh": odeh,
        "Danjon Limit": danjon,
        "Plot Path": "",
        "sunAz": sunAz,
        "moonAz": moonAz,
        "moonAlt": moonAlt
    };
}

function drawHilalVisualization(data) {
    const container = document.querySelector('.visual-container');
    container.style.display = 'block';
    
    // Clear previous SVG if any
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();
    if (document.getElementById('hilal-plot')) document.getElementById('hilal-plot').style.display = 'none';

    const width = 600;
    const height = 400;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.width = "100%";
    svg.style.maxWidth = "600px";
    svg.style.height = "auto";
    svg.style.background = "#020b1a";
    svg.style.borderRadius = "15px";
    svg.style.border = "1px solid rgba(255,255,255,0.1)";

    // Horizon
    const horizonY = height - 80;
    const horizon = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    horizon.setAttribute("x", "0");
    horizon.setAttribute("y", horizonY);
    horizon.setAttribute("width", width);
    horizon.setAttribute("height", "80");
    horizon.setAttribute("fill", "#0a1f3d");
    svg.appendChild(horizon);

    // Grid Scale (Azimuth)
    // We center the visualization on the Sun
    const centerAz = parseFloat(data["Azimuth Matahari"]);
    const scale = 30; // pixels per degree

    const getX = (az) => {
        let diff = az - centerAz;
        return (width / 2) + (diff * scale);
    };

    const getY = (alt) => {
        return horizonY - (alt * scale);
    };

    // Sun (Horizon)
    const sunMarker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    sunMarker.setAttribute("cx", width / 2);
    sunMarker.setAttribute("cy", horizonY);
    sunMarker.setAttribute("r", "15");
    sunMarker.setAttribute("fill", "url(#sunGradient)");
    
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const sunGrad = document.createElementNS("http://www.w3.org/2000/svg", "radialGradient");
    sunGrad.setAttribute("id", "sunGradient");
    sunGrad.innerHTML = '<stop offset="0%" stop-color="#ffcc33" /><stop offset="100%" stop-color="#ff6600" stop-opacity="0" />';
    defs.appendChild(sunGrad);
    svg.appendChild(defs);
    svg.appendChild(sunMarker);

    // Moon
    const moonX = getX(parseFloat(data["Azimuth Bulan"]));
    const moonY = getY(parseFloat(data["Altitude Hilal"]));
    
    const moon = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    moon.setAttribute("cx", moonX);
    moon.setAttribute("cy", moonY);
    moon.setAttribute("r", "8");
    moon.setAttribute("fill", "#ffff99");
    moon.setAttribute("filter", "blur(1px)");
    svg.appendChild(moon);

    // Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", moonX + 15);
    text.setAttribute("y", moonY);
    text.setAttribute("fill", "#ffcc33");
    text.setAttribute("style", "font-family: 'Outfit', sans-serif; font-size: 14px;");
    text.textContent = "HILAL";
    svg.appendChild(text);

    // Sun Label
    const sunText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    sunText.setAttribute("x", width / 2 - 35);
    sunText.setAttribute("y", horizonY + 25);
    sunText.setAttribute("fill", "#ffaa00");
    sunText.setAttribute("style", "font-family: 'Outfit', sans-serif; font-size: 12px;");
    sunText.textContent = "MATAHARI";
    svg.appendChild(sunText);

    container.appendChild(svg);
}

// --- History UI ---
function refreshHistoryList(type) {
    const list = document.getElementById(`history-list-${type}`);
    const key = type === 'single' ? HIST_SINGLE_KEY : HIST_RECAP_KEY;
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {
        console.warn('Local storage not available:', e);
    }
    list.innerHTML = '';
    if (history.length === 0) {
        list.innerHTML = `<p class="empty-msg">Belum ada riwayat ${type === 'single' ? '' : 'recap'}.</p>`;
        return;
    }
    history.slice().reverse().forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        const realIdx = history.length - 1 - idx;
        div.onclick = () => restoreFromHistory(type, realIdx);
        div.innerHTML = `<div class="info"><span class="name">${type === 'single' ? item.Lokasi : 'Rekap Nasional'}</span><span class="date">${item.Tanggal || (item.data && item.data[0] ? item.data[0].Tanggal : 'Data Rekap')}</span></div><i class="fas fa-chevron-right"></i>`;
        list.appendChild(div);
    });
}

function saveToHistory(type, data) {
    const key = type === 'single' ? HIST_SINGLE_KEY : HIST_RECAP_KEY;
    try {
        let history = JSON.parse(localStorage.getItem(key) || '[]');
        const isDup = history.some(item => (type === 'single' && item.Lokasi === data.Lokasi && item.Tanggal === data.Tanggal) || (type === 'recap' && item.Tanggal === data.Tanggal));
        if (isDup) return;
        history.push(data);
        if (history.length > 20) history.shift();
        localStorage.setItem(key, JSON.stringify(history));
    } catch (e) {
        console.warn('Local storage not available for saving:', e);
    }
    refreshHistoryList(type);
}

function clearHistory(type) {
    if (confirm(`Hapus semua riwayat ${type === 'single' ? 'perhitungan' : 'rekap'}?`)) {
        try {
            localStorage.removeItem(type === 'single' ? HIST_SINGLE_KEY : HIST_RECAP_KEY);
        } catch(e){}
        refreshHistoryList(type);
    }
}

function restoreFromHistory(type, index) {
    const key = type === 'single' ? HIST_SINGLE_KEY : HIST_RECAP_KEY;
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem(key) || '[]');
    } catch(e){}
    const data = history[index];
    if (type === 'single') {
        currentFullResult = data;
        renderResult(data);
        document.getElementById('city-input').value = data.Lokasi;
    } else {
        currentRecapData = data.data;
        renderRecapTable(data.data);
    }
}

// Single City Calculation
document.getElementById('calculate-btn').addEventListener('click', () => {
    const city = document.getElementById('city-input').value;
    const date = getISODate(obsPicker);
    if (!city || !date) { alert('Mohon pilih kota dan tanggal terlebih dahulu.'); return; }
    
    showLoader('Menghitung parameter astronomis...');
    document.getElementById('result-section').classList.add('hidden');
    
    setTimeout(() => {
        const data = calculateHilalJS(city, date);
        hideLoader();
        if (data.error) { alert(data.error); return; }
        currentFullResult = data;
        renderResult(data);
        saveToHistory('single', data);
    }, 300);
});

function renderResult(data) {
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('res-location').textContent = data.Lokasi;
    document.getElementById('res-date').textContent = data.Tanggal;
    document.getElementById('val-sunset').textContent = data.Sunset;
    document.getElementById('val-sun-az').textContent = data['Azimuth Matahari'];
    document.getElementById('val-sun-alt').textContent = data['Altitude Matahari'] || '0';
    document.getElementById('val-moonset').textContent = data.Moonset;
    document.getElementById('val-moon-az').textContent = data['Azimuth Bulan'];
    document.getElementById('val-moon-alt').textContent = data['Altitude Hilal'];
    document.getElementById('val-elongation').textContent = data.Elongasi;
    document.getElementById('val-age').textContent = data['Umur Bulan (Jam)'];
    document.getElementById('val-lag').textContent = data['Lag Time (Menit)'];
    
    const mabims = document.getElementById('stat-mabims');
    mabims.textContent = data.MABIMS;
    mabims.className = 'badge ' + (data.MABIMS.includes('Tidak') ? 'danger' : 'success');
    
    const odeh = document.getElementById('stat-odeh');
    odeh.textContent = data.Odeh;
    odeh.className = 'badge ' + ((data.Odeh.includes('Invisible') || data.Odeh.includes('D')) ? 'danger' : 'success');
    
    const danjon = document.getElementById('stat-danjon');
    danjon.textContent = data['Danjon Limit'];
    danjon.className = 'badge ' + (data['Danjon Limit'].includes('Tidak') ? 'danger' : 'success');
    
    
    // Show SVG visualization
    drawHilalVisualization(data);
}

// Recap Nasional
document.getElementById('recap-btn').addEventListener('click', () => {
    const date = getISODate(recapPicker);
    if (!date) { alert('Mohon pilih tanggal terlebih dahulu.'); return; }
    
    showLoader('Menghitung Rekap Nasional...');
    document.getElementById('recap-result').classList.add('hidden');
    
    setTimeout(() => {
        const results = [];
        if (typeof PROVINCIAL_CAPITALS !== 'undefined') {
            PROVINCIAL_CAPITALS.forEach(cityName => {
                const res = calculateHilalJS(cityName, date);
                if (!res.error) results.push({
                    Lokasi: res.Lokasi, Sunset: res.Sunset, Altitude: res['Altitude Hilal'],
                    Elongasi: res.Elongasi, MABIMS: res.MABIMS, Odeh: res.Odeh
                });
            });
        }
        hideLoader();
        currentRecapData = results;
        renderRecapTable(results);
        saveToHistory('recap', { data: results, Tanggal: `Rekap ${date}` });
    }, 500);
});

function renderRecapTable(data) {
    const body = document.getElementById('recap-body');
    body.innerHTML = '';
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${item.Lokasi}</td><td>${item.Sunset}</td><td>${item.Altitude}°</td><td>${item.Elongasi}°</td>
            <td><span class="badge ${item.MABIMS.includes('Tidak') ? 'danger' : 'success'}">${item.MABIMS}</span></td>
            <td><span class="badge ${(item.Odeh.includes('Invisible') || item.Odeh.includes('D')) ? 'danger' : 'success'}">${item.Odeh}</span></td>`;
        body.appendChild(tr);
    });
    document.getElementById('recap-result').classList.remove('hidden');
}

function sortTable(n) {
    if (!currentRecapData) return;
    const keys = ['Lokasi', 'Sunset', 'Altitude', 'Elongasi', 'MABIMS', 'Odeh'];
    const key = keys[n];
    
    // Sort table globally
    window.__tableAsc = !window.__tableAsc;
    const isAsc = window.__tableAsc;
    
    currentRecapData.sort((a, b) => {
        let valA = a[key], valB = b[key];
        if (key === 'Altitude' || key === 'Elongasi') { valA = parseFloat(valA); valB = parseFloat(valB); }
        if (valA < valB) return isAsc ? -1 : 1;
        if (valA > valB) return isAsc ? 1 : -1;
        return 0;
    });
    renderRecapTable(currentRecapData);
}

// Exports (Web version uses CSV blobs)
document.getElementById('export-recap-csv').addEventListener('click', () => {
    if (!currentRecapData) return;
    let csvContent = "data:text/csv;charset=utf-8,Lokasi,Sunset,Altitude,Elongasi,MABIMS,Odeh\n";
    currentRecapData.forEach(row => { csvContent += `${row.Lokasi},${row.Sunset},${row.Altitude},${row.Elongasi},${row.MABIMS},${row.Odeh}\n`; });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `recap_hilal_${getISODate(recapPicker)}.csv`);
    document.body.appendChild(link);
    link.click();
});
document.getElementById('export-recap-xlsx').addEventListener('click', () => alert('Export XLSX butuh server backend. Silakan gunakan Export CSV.'));

// downloadAs for Single Tab
async function downloadAs(format) {
    if (!currentFullResult) return;
    let content = "";
    let filename = `report_hilal_${currentFullResult.Lokasi}_${currentFullResult.Tanggal}`;
    let type = "text/plain";

    if (format === 'csv') {
        content = "Parameter,Nilai\n";
        for (const [k, v] of Object.entries(currentFullResult)) {
            if (!['sunAz', 'moonAz', 'moonAlt', 'Plot Path'].includes(k)) {
                content += `${k},"${v}"\n`;
            }
        }
        type = "text/csv";
        filename += ".csv";
    } else if (format === 'md') {
        content = `# Report Hilal: ${currentFullResult.Lokasi}\n\n`;
        content += `**Tanggal:** ${currentFullResult.Tanggal}\n\n`;
        content += "| Parameter | Nilai |\n|---|---|\n";
        for (const [k, v] of Object.entries(currentFullResult)) {
            if (!['sunAz', 'moonAz', 'moonAlt', 'Plot Path'].includes(k)) {
                content += `| ${k} | ${v} |\n`;
            }
        }
        type = "text/markdown";
        filename += ".md";
    } else {
        content = `REPORT HILAL EYE\n===============\n\n`;
        for (const [k, v] of Object.entries(currentFullResult)) {
            if (!['sunAz', 'moonAz', 'moonAlt', 'Plot Path'].includes(k)) {
                content += `${k}: ${v}\n`;
            }
        }
        filename += ".txt";
    }

    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// --- Direct Gemini API Chat (Client Side) ---
let chatHistory = [];
document.getElementById('send-chat-btn').addEventListener('click', () => sendChatMessage());
document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    const apiKey = document.getElementById('gemini-key').value;
    if (!message || !apiKey) { alert('API Key Gemini & Pesan wajib diisi!'); return; }

    appendMessage('user', message);
    input.value = '';
    const chatMsgs = document.getElementById('chat-messages');
    chatMsgs.scrollTop = chatMsgs.scrollHeight;

    let contextPayload = null;
    if (currentFullResult && Object.keys(currentFullResult).length > 0) {
        contextPayload = currentFullResult;
    } else if (currentRecapData && currentRecapData.length > 0) {
        const dateRaw = document.getElementById('recap-date').value || "Hari ini";
        contextPayload = { "Tipe Data": "Rekapitulasi Nasional (Top 5 Kota)", "Tanggal Observasi": dateRaw };
        currentRecapData.slice(0,5).forEach((item, index) => { contextPayload[`Kota ${index+1}`] = `${item.Lokasi} | Alt: ${item.Altitude}° | Elong: ${item.Elongasi}° | MABIMS: ${item.MABIMS}`; });
    } else {
        try {
            const histSingle = JSON.parse(localStorage.getItem('hilal_eye_hist_single')) || [];
            const histRecap = JSON.parse(localStorage.getItem('hilal_eye_hist_recap')) || [];
            if (histRecap.length > 0) {
               const latestRecapObj = histRecap[histRecap.length - 1];
               contextPayload = { "Tipe Data": "Rekapitulasi Nasional (Dari History)", "Tanggal Observasi": latestRecapObj.Tanggal.replace('Rekap ', '') };
               latestRecapObj.data.slice(0,5).forEach((item, index) => { contextPayload[`Kota ${index+1}`] = `${item.Lokasi} | Alt: ${item.Altitude}° | Elong: ${item.Elongasi}° | MABIMS: ${item.MABIMS}`; });
            } else if (histSingle.length > 0) contextPayload = histSingle[histSingle.length - 1];
        } catch(e) {}
    }

    let ctxText = "DATA PERHITUNGAN TERBARU: [KOSONG]\n";
    if (contextPayload) {
        ctxText = "DATA PERHITUNGAN TERBARU (PENTING: GUNAKAN INI SEBAGAI SUMBER UTAMA):\n";
        for (const [k, v] of Object.entries(contextPayload)) if (k !== 'Plot Path') ctxText += `- ${k}: ${v}\n`;
    }

    const systemPrompt = "Anda adalah Konsultan Astronomi Hilal-Eye. Tugas utama Anda adalah menyimpulkan kapan awal bulan Hijriah (misalnya 1 Syawal/Lebaran atau 1 Ramadhan) berdasarkan 'DATA PERHITUNGAN TERBARU' yang diberikan.\nATURAN DEDUKSI KALENDER:\n1. Perhatikan 'Tanggal Observasi' yang ada di data (Ini biasanya adalah tanggal 29 bulan Hijriah).\n2. Jika data menunjukkan kriteria MABIMS 'Tidak', Anda HARUS menyimpulkan bahwa hilal tidak terlihat, bulan berjalan digenapkan 30 hari (istikmal), dan bulan baru (misal Lebaran) akan jatuh PADA LUSA dari tanggal observasi tersebut.\n3. Jika data menunjukkan kriteria MABIMS 'Ya', Anda HARUS menyimpulkan bahwa bulan baru jatuh PADA KEESOKAN HARINYA dari tanggal observasi.\nJangan menolak menjawab pertanyaan 'kapan lebaran'. Gunakan logika di atas untuk menghitungnya dari tanggal observasi.\nJawablah dalam Bahasa Indonesia yang profesional. GUNAKAN FORMAT MARKDOWN.";

    try {
        const payload = {
            contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${ctxText}\n\nUser Question: ${message}` }] }],
            generationConfig: { temperature: 0.2 }
        };
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.error) appendMessage('ai', `Error Gemini: ${data.error.message}`);
        else appendMessage('ai', data.candidates[0].content.parts[0].text);
    } catch (err) { appendMessage('ai', 'Gagal menghubungi Gemini API. Cek koneksi.'); }
    finally { chatMsgs.scrollTop = chatMsgs.scrollHeight; }
}

function appendMessage(role, text) {
    const container = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}-message`;
    if (role === 'ai') msgDiv.innerHTML = marked.parse(text);
    else msgDiv.textContent = text;
    container.appendChild(msgDiv);
}

// Webapp chat exports
function copyToClipboard() { /* generic */ }
function toggleChatFullscreen() {
    const cw = document.getElementById('chat-wrapper'), icon = document.querySelector('#toggle-fullscreen-btn i');
    cw.classList.toggle('fullscreen-chat');
    if (cw.classList.contains('fullscreen-chat')) { icon.classList.remove('fa-expand'); icon.classList.add('fa-compress'); }
    else { icon.classList.remove('fa-compress'); icon.classList.add('fa-expand'); }
}
function copyChat() {
    const msgs = Array.from(document.querySelectorAll('#chat-messages .message')).map(m => `${m.classList.contains('user-message')?'Anda':'AI'}:\n${m.innerText}\n\n`).join('');
    navigator.clipboard.writeText(msgs).then(() => alert('Seluruh chat berhasil disalin!'));
}
function downloadChat(format) { 
    const msgs = Array.from(document.querySelectorAll('#chat-messages .message')).map(m => `${m.classList.contains('user-message')?'Anda':'AI'}:\n${m.innerText}\n\n`).join('');
    const blob = new Blob([msgs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat_hilal_eye_${new Date().getTime()}.${format === 'docx' ? 'txt' : format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    if (format === 'docx') alert('Format DOCX dikonversi ke TXT karena batasan client-side.');
}
function printChat() { window.print(); }

function showLoader(text) {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (text && loaderText) loaderText.textContent = text;
    if (loader) loader.classList.remove('hidden');
}

function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
}
