document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENT SELECTORS ---
    const importExportBtn = document.getElementById('import-export-btn');
    const importExportPanel = document.getElementById('import-export-panel');
    const exportDataBtn = document.getElementById('export-data-btn');
    const importFileInput = document.getElementById('import-file-input');
    const importExportBackBtn = document.getElementById('import-export-back-btn');

    const iosInstallModal = document.getElementById('ios-install-modal');
    const iosInstallDoneBtn = document.getElementById('ios-install-done-btn');

    const installBanner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');
    const closeInstallBannerBtn = document.getElementById('close-install-banner-btn');

    const mainContent = document.getElementById('main-content');
    const optionsBtn = document.getElementById('options-btn');
    const optionsCloseBtn = document.getElementById('options-close-btn');
    const setGoalsBtn = document.getElementById('set-goals-btn');
    const planScheduleBtn = document.getElementById('plan-schedule-btn');
    const viewMedalsBtn = document.getElementById('view-medals-btn');
    const shareOptionBtn = document.getElementById('share-option-btn');
    const sharePanel = document.getElementById('share-panel');
    const shareWithFriendBtn = document.getElementById('share-with-friend-btn');
    const shareBackBtn = document.getElementById('share-back-btn');
    
    const schedulePanel = document.getElementById('schedule-panel');
    const scheduleCancelBtn = document.getElementById('schedule-cancel-btn');
    const scheduleSaveBtn = document.getElementById('schedule-save-btn');
    const scheduleDayCheckboxes = document.querySelectorAll('.schedule-day-checkbox');
    const scheduleHoursInputs = document.querySelectorAll('.schedule-hours-input');
    const scheduleMinutesInputs = document.querySelectorAll('.schedule-minutes-input');
    
    const goalPanel = document.getElementById('goal-panel');
    const goalPanelTitle = document.getElementById('goal-panel-title');
    const goalCancelBtn = document.getElementById('goal-cancel-btn');
    const goalSaveBtn = document.getElementById('goal-save-btn');
    const monthlyGoalInput = document.getElementById('monthly-goal-input');
    const yearlyGoalInput = document.getElementById('yearly-goal-input');

    const alertModal = document.getElementById('alert-modal');
    const alertMessage = document.getElementById('alert-message');
    const alertOkBtn = document.getElementById('alert-ok-btn');

    const currentMonthYearEl = document.getElementById('current-month-year');
    const calendarGridEl = document.getElementById('calendar-grid');
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');

    const monthTotalHoursEl = document.getElementById('month-total-hours');
    const monthTotalStudiesEl = document.getElementById('month-total-studies');
    const monthGoalEl = document.getElementById('month-goal');
    const monthTimeLeftEl = document.getElementById('month-time-left');
    const monthPercentEl = document.getElementById('month-percent');
    
    const yearAccumulatedHoursEl = document.getElementById('year-accumulated-hours');
    const yearRemainingHoursEl = document.getElementById('year-remaining-hours');
    const yearPercentEl = document.getElementById('year-percent');
    const yearGoalEl = document.getElementById('year-goal');

    const modal = document.getElementById('entry-modal');
    const modalTitleEl = document.getElementById('modal-title');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalSaveBtn = document.getElementById('modal-save-btn');
    const timeHoursInput = document.getElementById('time-hours-input');
    const timeMinutesInput = document.getElementById('time-minutes-input');
    const studiesInput = document.getElementById('studies-input');
    const notesInput = document.getElementById('notes-input');


    // --- STATE & DATABASE ---
    let deferredPrompt;
    let currentDate = new Date();
    let currentlyEditingDate = null; 
    let database = JSON.parse(localStorage.getItem('serviceTimeTrackerDB')) || {};
    const defaultSettings = {
        monthlyGoal: 50,
        yearlyGoal: 600,
        schedule: {}
    };
    const loadedSettings = JSON.parse(localStorage.getItem('serviceTimeTrackerSettings')) || {};
    let settings = { ...defaultSettings, ...loadedSettings };

    
    // --- HELPER FUNCTIONS ---
    function formatMinutesToDisplay(totalMinutes) {
        if (!totalMinutes && totalMinutes !== 0) return '0h 0min';
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${minutes}min`;
    }


    // --- CORE FUNCTIONS ---
    function saveData() {
        localStorage.setItem('serviceTimeTrackerDB', JSON.stringify(database));
    }

    function saveSettings() {
        localStorage.setItem('serviceTimeTrackerSettings', JSON.stringify(settings));
    }

    function updateSummary() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        let monthTotalMinutes = 0, monthTotalStudies = 0;

        for (const dateKey in database) {
            const entryDate = new Date(dateKey + 'T00:00:00');
            if (entryDate.getFullYear() === year && entryDate.getMonth() === month) {
                const entry = database[dateKey];
                monthTotalMinutes += entry.time || 0;
                monthTotalStudies += entry.studies || 0;
            }
        }
        
        monthTotalHoursEl.textContent = formatMinutesToDisplay(monthTotalMinutes);
        monthTotalStudiesEl.textContent = monthTotalStudies;
        
        const monthlyGoalMinutes = settings.monthlyGoal * 60;
        const minutesLeft = Math.max(0, monthlyGoalMinutes - monthTotalMinutes);
        const percentComplete = monthlyGoalMinutes > 0 ? (monthTotalMinutes / monthlyGoalMinutes) * 100 : 0;

        monthGoalEl.textContent = settings.monthlyGoal;
        monthTimeLeftEl.textContent = formatMinutesToDisplay(minutesLeft);
        monthPercentEl.textContent = percentComplete.toFixed(1);

        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();
        let serviceYearStartYear = currentYear;
        if (currentMonth < 8) { // Service year starts in September
            serviceYearStartYear = currentYear - 1;
        }
        const serviceYearStartDate = new Date(serviceYearStartYear, 8, 1); // September 1st

        let yearTotalMinutes = 0;
        for (const dateKey in database) {
            const entryDate = new Date(dateKey + 'T00:00:00');
            if (entryDate >= serviceYearStartDate) {
                yearTotalMinutes += database[dateKey].time || 0;
            }
        }

        const yearlyGoalMinutes = settings.yearlyGoal * 60;
        const yearMinutesLeft = Math.max(0, yearlyGoalMinutes - yearTotalMinutes);
        const yearPercentComplete = yearlyGoalMinutes > 0 ? (yearTotalMinutes / yearlyGoalMinutes) * 100 : 0;
        
        yearAccumulatedHoursEl.textContent = formatMinutesToDisplay(yearTotalMinutes);
        yearGoalEl.textContent = settings.yearlyGoal;
        yearRemainingHoursEl.textContent = formatMinutesToDisplay(yearMinutesLeft);
        yearPercentEl.textContent = yearPercentComplete.toFixed(1);
    }

    function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthName = currentDate.toLocaleString('en-US', { month: 'long' });
        currentMonthYearEl.textContent = `${monthName} ${year}`;
        calendarGridEl.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay();

        for (let i = 0; i < firstDayOfMonth; i++) {
            const paddingDay = document.createElement('div');
            paddingDay.classList.add('calendar-day', 'padding');
            calendarGridEl.appendChild(paddingDay);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dayEl = document.createElement('div');
            dayEl.classList.add('calendar-day');

            const dayDate = new Date(year, month, i);
            const dateKey = dayDate.toISOString().split('T')[0];
            dayEl.dataset.date = dateKey;

            if (dayDate.getTime() === today.getTime()) {
                dayEl.classList.add('today');
            }

            const dayOfWeek = dayDate.getDay();
            const plannedMinutes = settings.schedule[dayOfWeek] || 0;
            const actualMinutes = database[dateKey]?.time || 0;

            if (plannedMinutes > 0) {
                if (actualMinutes >= plannedMinutes) {
                    dayEl.classList.add('complete');
                } else if (dayDate < today) {
                    if (actualMinutes > 0) {
                        dayEl.classList.add('under');
                    } else {
                        dayEl.classList.add('missed');
                    }
                } else {
                    dayEl.classList.add('future-planned');
                }
            }

            const dayHeader = document.createElement('div');
            dayHeader.className = 'day-header';

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';
            dayNumber.textContent = i;
            dayHeader.appendChild(dayNumber);

            const entry = database[dateKey];
            if (entry && entry.notes && entry.notes.trim() !== '') {
                const noteIcon = document.createElement('span');
                noteIcon.className = 'note-indicator';
                noteIcon.textContent = '📝';
                dayHeader.appendChild(noteIcon);
            }
            
            dayEl.appendChild(dayHeader);
            
            const summaryContent = [];
            if (plannedMinutes > 0) {
                summaryContent.push(`🎯: ${formatMinutesToDisplay(plannedMinutes)}`);
            }
            if (plannedMinutes > 0 && actualMinutes > 0) {
                summaryContent.push('<hr class="day-summary-divider">');
            }
            if (actualMinutes > 0) {
                summaryContent.push(`⏱️: ${formatMinutesToDisplay(actualMinutes)}`);
            }
            
            if (summaryContent.length > 0) {
                const summary = document.createElement('div');
                summary.className = 'day-summary';
                summary.innerHTML = summaryContent.join('');
                dayEl.appendChild(summary);
            }

            calendarGridEl.appendChild(dayEl);
        }

        updateSummary();
    }

    // --- DATA ENTRY MODAL FUNCTIONS ---
    function openModal(dateKey) {
        currentlyEditingDate = dateKey;
        const existingEntry = database[dateKey] || {};
        const totalMinutes = existingEntry.time || 0;

        timeHoursInput.value = Math.floor(totalMinutes / 60);
        timeMinutesInput.value = totalMinutes % 60;
        studiesInput.value = existingEntry.studies ?? '';
        notesInput.value = existingEntry.notes || '';
        
        const dateObj = new Date(dateKey + 'T00:00:00');
        modalTitleEl.textContent = `Editing ${dateObj.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;

        timeHoursInput.classList.remove('invalid');
        timeMinutesInput.classList.remove('invalid');

        modal.classList.add('visible');
        timeHoursInput.focus();
    }

    function closeModal() {
        modal.classList.remove('visible');
        currentlyEditingDate = null;
    }

    function saveModalData() {
        if (!currentlyEditingDate) return;

        const hours = parseInt(timeHoursInput.value) || 0;
        const minutes = parseInt(timeMinutesInput.value) || 0;

        if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) {
            alert("Invalid time. Please enter a value up to 24h 00min, with minutes less than 60.");
            timeHoursInput.classList.add('invalid');
            timeMinutesInput.classList.add('invalid');
            return;
        }

        const totalMinutes = (hours * 60) + minutes;
        const studies = parseInt(studiesInput.value);

        database[currentlyEditingDate] = {
            time: totalMinutes,
            studies: isNaN(studies) ? 0 : studies,
            notes: notesInput.value.trim()
        };

        saveData();
        renderCalendar();
        closeModal();
    }
    
    // --- ALERT MODAL FUNCTIONS ---
    function openAlertModal(message) {
        alertMessage.textContent = message;
        alertModal.classList.add('visible');
    }

    function closeAlertModal() {
        alertModal.classList.remove('visible');
    }

    // --- OPTIONS PANEL FUNCTIONS ---
    function openOptionsPanel() {
        document.body.classList.add('options-open');
    }

    function closeOptionsPanel() {
        document.body.classList.remove('options-open');
    }

    function openSharePanel() {
        sharePanel.classList.add('visible');
    }

    function closeSharePanel() {
        sharePanel.classList.remove('visible');
    }

    function openImportExportPanel() {
        importExportPanel.classList.add('visible');
    }

    function closeImportExportPanel() {
        importExportPanel.classList.remove('visible');
    }

    function exportData() {
        const dataToExport = {
            database: database,
            settings: settings
        };
        const dataStr = JSON.stringify(dataToExport, null, 2);
        const dataBlob = new Blob([dataStr], {type: "application/json"});
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.download = `serviceTimeTracker_backup.json`;
        link.href = url;
        link.click();
        
        URL.revokeObjectURL(url); // Clean up
        openAlertModal('Backup file has been downloaded!');
    }

    function importData(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                // Basic validation
                if (importedData.database && importedData.settings) {
                    if (confirm("This will overwrite all current data. Are you sure you want to continue?")) {
                        database = importedData.database;
                        settings = importedData.settings;
                        saveData();
                        saveSettings();
                        renderCalendar(); // Refresh the UI
                        openAlertModal('Data successfully imported!');
                    }
                } else {
                    openAlertModal('Error: Invalid backup file.');
                }
            } catch (error) {
                openAlertModal('Error: Could not read the file. Please make sure it is a valid backup file.');
            }
        };
        reader.readAsText(file);
        
        // Reset the file input so you can import the same file again if needed
        event.target.value = null;
    }

    function shareApp() {
        if (navigator.share) { // Checks if the browser supports the Share API
            navigator.share({
                title: 'Service Time Tracker',
                text: 'Check out this app for tracking service time!',
                url: 'https://muychakisimo.github.io/ServiceHourTracker/'
            })
            .then(() => console.log('Successful share'))
            .catch((error) => console.log('Error sharing', error));
        } else {
            // Fallback for browsers that don't support it
            openAlertModal('Share feature not supported on this browser.');
        }
    }

    // --- SCHEDULE PANEL FUNCTIONS ---
    function openSchedulePanel() {
        for (let i = 0; i < 7; i++) {
            const plannedMinutes = settings.schedule[i] || 0;
            const isChecked = plannedMinutes > 0;
            
            scheduleDayCheckboxes[i].checked = isChecked;
            scheduleHoursInputs[i].value = isChecked ? Math.floor(plannedMinutes / 60) : '';
            scheduleMinutesInputs[i].value = isChecked ? plannedMinutes % 60 : '';
        }
        schedulePanel.classList.add('visible');
    }
    
    function closeSchedulePanel() {
        schedulePanel.classList.remove('visible');
    }
    
    function saveSchedule() {
        const newSchedule = {};
        for (let i = 0; i < 7; i++) {
            if (scheduleDayCheckboxes[i].checked) {
                const hours = parseInt(scheduleHoursInputs[i].value) || 0;
                const minutes = parseInt(scheduleMinutesInputs[i].value) || 0;
                newSchedule[i] = (hours * 60) + minutes;
            }
        }
        settings.schedule = newSchedule;
        saveSettings();
        renderCalendar();
        closeSchedulePanel();
    }

    // --- GOAL PANEL FUNCTIONS ---
    function openGoalPanel() {
        monthlyGoalInput.value = settings.monthlyGoal;
        yearlyGoalInput.value = settings.yearlyGoal;
        goalPanel.classList.add('visible');
    }

    function closeGoalPanel() {
        goalPanel.classList.remove('visible');
    }

    function saveGoals() {
        const newMonthlyGoal = parseFloat(monthlyGoalInput.value);
        const newYearlyGoal = parseFloat(yearlyGoalInput.value);

        if (isNaN(newMonthlyGoal) || newMonthlyGoal < 0 || isNaN(newYearlyGoal) || newYearlyGoal < 0) {
            alert('Please enter valid, positive numbers for both goals.');
            return;
        }

        settings.monthlyGoal = newMonthlyGoal;
        settings.yearlyGoal = newYearlyGoal;
        
        saveSettings();
        updateSummary();
        closeGoalPanel();
    }

    // --- EVENT LISTENERS ---
    iosInstallDoneBtn.addEventListener('click', () => {
        iosInstallModal.classList.remove('visible');
        localStorage.setItem('hasSeenIosInstallPrompt', 'true');
    });

    installBtn.addEventListener('click', (e) => {
        installBanner.classList.remove('visible'); // Hide our banner
        deferredPrompt.prompt(); // Show the browser's install prompt
    });

    closeInstallBannerBtn.addEventListener('click', (e) => {
        installBanner.classList.remove('visible'); // Just hide our banner
    });

    optionsBtn.addEventListener('click', openOptionsPanel);
    optionsCloseBtn.addEventListener('click', closeOptionsPanel);
    planScheduleBtn.addEventListener('click', openSchedulePanel);
    scheduleCancelBtn.addEventListener('click', closeSchedulePanel);
    scheduleSaveBtn.addEventListener('click', saveSchedule);
    goalCancelBtn.addEventListener('click', closeGoalPanel);
    goalSaveBtn.addEventListener('click', saveGoals);
    viewMedalsBtn.addEventListener('click', () => openAlertModal('Coming Soon!'));
    shareOptionBtn.addEventListener('click', openSharePanel);
    shareWithFriendBtn.addEventListener('click', shareApp);
    shareBackBtn.addEventListener('click', closeSharePanel);
    alertOkBtn.addEventListener('click', closeAlertModal);
    setGoalsBtn.addEventListener('click', openGoalPanel);

    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });

    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    calendarGridEl.addEventListener('click', (event) => {
        const dayElement = event.target.closest('.calendar-day');
        if (dayElement && !dayElement.classList.contains('padding')) {
            openModal(dayElement.dataset.date);
        }
    });

    modalCloseBtn.addEventListener('click', closeModal);
    modalSaveBtn.addEventListener('click', saveModalData);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    importExportBtn.addEventListener('click', openImportExportPanel);
    importExportBackBtn.addEventListener('click', closeImportExportPanel);
    exportDataBtn.addEventListener('click', exportData);
    importFileInput.addEventListener('change', importData);

    // --- INITIALIZATION ---
    // --- iOS INSTALL PROMPT LOGIC ---
    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

    // If the user is on iOS, not in standalone mode, and has not seen the prompt before
    if (isIOS() && !isInStandaloneMode() && !localStorage.getItem('hasSeenIosInstallPrompt')) {
        iosInstallModal.classList.add('visible');
    }
    
    renderCalendar();

    // PWA: SERVICE WORKER REGISTRATION
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
                console.error('ServiceWorker registration failed: ', error);
            });
    });
}

// --- PWA INSTALL PROMPT LOGIC ---
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Show our custom install banner
        installBanner.classList.add('visible');
    });
});