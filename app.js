document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENT SELECTORS ---
    const notificationsBtn = document.getElementById('notifications-btn');
    const notificationsPanel = document.getElementById('notifications-panel');
    const notificationsBackBtn = document.getElementById('notifications-back-btn');
    const notificationsToggle = document.getElementById('notifications-toggle');
    const notificationTimeInput = document.getElementById('notification-time');

    const yearProgressBar = document.getElementById('year-progress-bar');
    const yearProgressText = document.getElementById('year-progress-text');
    const yearGoalEmoji = document.getElementById('year-goal-emoji');

    const serviceYearTitleEl = document.getElementById('service-year-title');

    const medalsPanel = document.getElementById('medals-panel');
    const medalsListContainer = document.getElementById('medals-list-container');
    const medalsBackBtn = document.getElementById('medals-back-btn');

    const monthProgressBar = document.getElementById('month-progress-bar');
    const monthProgressText = document.getElementById('month-progress-text');
    const monthGoalEmoji = document.getElementById('month-goal-emoji');

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
        monthGoal: 0,
        yearGoal: 0,
        schedule: {},
        notifications: { enabled: false, time: '12:00' } // Add this line
    };

    const defaultMedals = {
        completedMonths: [], // An array to store 'YYYY-MM' strings
        completedYears: []   // An array to store the start year of the service year
    };

    const loadedMedals = JSON.parse(localStorage.getItem('serviceTimeTrackerMedals')) || {};
    let medals = { ...defaultMedals, ...loadedMedals };

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
    function openNotificationsPanel() {
        // Load saved settings into the UI
        notificationsToggle.checked = settings.notifications.enabled || false;
        notificationTimeInput.value = settings.notifications.time || '12:00'; // Changed to midday
        notificationsPanel.classList.add('visible');
    }

    function closeNotificationsPanel() {
        notificationsPanel.classList.remove('visible');
    }

    function handleNotificationsToggle() {
        const isEnabled = notificationsToggle.checked;
        if (isEnabled) {
            // Ask for permission if not already granted
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        settings.notifications.enabled = true;
                        saveNotificationSettings();
                    } else {
                        // User denied permission, so uncheck the box
                        notificationsToggle.checked = false;
                    }
                });
            } else if (Notification.permission === 'denied') {
                openAlertModal('Notification permission was previously denied. Please enable it in your browser settings.');
                notificationsToggle.checked = false;
            } else { // Permission already granted
                settings.notifications.enabled = true;
                saveNotificationSettings();
            }
        } else { // User is disabling notifications
            settings.notifications.enabled = false;
            saveNotificationSettings();
        }
    }

    async function saveNotificationSettings() {
        if (!settings.notifications) {
            settings.notifications = {};
        }
        settings.notifications.enabled = notificationsToggle.checked;
        settings.notifications.time = notificationTimeInput.value;
        saveSettings();

        // --- Communicate with the Service Worker ---
        if (navigator.serviceWorker.controller) {
            // Send the latest settings to the service worker
            navigator.serviceWorker.controller.postMessage({
                action: 'updateSettings',
                settings: settings
            });
        }
        
        const registration = await navigator.serviceWorker.ready;
        if (settings.notifications.enabled) {
            try {
                // Register a periodic check that will run roughly once a day
                await registration.periodicSync.register('check-reminder', {
                    minInterval: 24 * 60 * 60 * 1000, // 24 hours
                });
            } catch (error) {
                console.error('Periodic Sync could not be registered:', error);
                openAlertModal('Reminders could not be set up. Your device may not support background tasks.');
            }
        } else {
            // If disabled, unregister the periodic check
            await registration.periodicSync.unregister('check-reminder');
        }
    }

    function saveData() {
        localStorage.setItem('serviceTimeTrackerDB', JSON.stringify(database));
    }

    function saveSettings() {
        localStorage.setItem('serviceTimeTrackerSettings', JSON.stringify(settings));
    }

    function saveMedals() {
        localStorage.setItem('serviceTimeTrackerMedals', JSON.stringify(medals));
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
        // Update the new progress bar UI
        monthProgressBar.style.width = `${Math.min(percentComplete, 100)}%`;
        monthProgressText.textContent = `${percentComplete.toFixed(0)}%`;

        // Update the state of the emoji (incomplete or complete)
        if (percentComplete >= 100) {
            monthGoalEmoji.classList.remove('incomplete');
            monthGoalEmoji.classList.add('complete'); // Add the glow class
        } else {
            monthGoalEmoji.classList.add('incomplete');
            monthGoalEmoji.classList.remove('complete'); // Remove the glow class
        }

        // --- MEDAL AWARDING LOGIC ---
        // Create a unique key for the current month (e.g., "2025-10")
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Check if the goal is complete AND if the medal for this month hasn't been awarded yet
        if (percentComplete >= 100 && !medals.completedMonths.includes(monthKey)) {
            medals.completedMonths.push(monthKey); // Add this month to the list of completed months
            saveMedals(); // Save the achievement
            
            // Show a congratulatory pop-up
            openAlertModal('Congratulations! You completed your monthly goal and earned a medal!');
        }

        // --- SERVICE YEAR CALCULATION & DISPLAY ---
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth(); // 0 = Jan, 8 = Sep

        let serviceYearStartYear;
        // If it's Sep-Dec (month 8-11), the service year started this year.
        if (currentMonth >= 8) {
            serviceYearStartYear = currentYear;
        } else { // If it's Jan-Aug (month 0-7), it started last year.
            serviceYearStartYear = currentYear - 1;
        }

        // Update the title display (e.g., "Service Year 25/26")
        const startYearShort = serviceYearStartYear.toString().slice(-2);
        const endYearShort = (serviceYearStartYear + 1).toString().slice(-2);
        serviceYearTitleEl.textContent = `Service Year ${startYearShort}/${endYearShort}`;

        // Calculate total hours for the service year
        const serviceYearStartDate = new Date(serviceYearStartYear, 8, 1); // Sep 1st
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
        // Update the new yearly progress bar UI
        yearProgressBar.style.width = `${Math.min(yearPercentComplete, 100)}%`;
        yearProgressText.textContent = `${yearPercentComplete.toFixed(0)}%`;

        // Update the state of the trophy emoji
        if (yearPercentComplete >= 100) {
            yearGoalEmoji.classList.remove('incomplete');
            yearGoalEmoji.classList.add('trophy-glow');
        } else {
            yearGoalEmoji.classList.add('incomplete');
            yearGoalEmoji.classList.remove('trophy-glow');
        }

        // --- TROPHY AWARDING LOGIC ---
        // Check if the yearly goal is complete AND if the trophy for this service year hasn't been awarded yet
        if (yearPercentComplete >= 100 && !medals.completedYears.includes(serviceYearStartYear)) {
            medals.completedYears.push(serviceYearStartYear); // Add this service year to the list
            saveMedals(); // Save the achievement
            
            // Show a congratulatory pop-up
            openAlertModal('Amazing! You completed your service year goal and earned a trophy!');
        }
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
    document.body.classList.add('modal-open');
    function openModal(dateKey) {
        currentlyEditingDate = dateKey;
        const existingEntry = database[dateKey] || {};
        const totalMinutes = existingEntry.time || 0;

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const studies = existingEntry.studies || 0;

        timeHoursInput.value = hours > 0 ? hours : '';
        timeMinutesInput.value = minutes > 0 ? minutes : '';
        studiesInput.value = studies > 0 ? studies : '';

        notesInput.value = existingEntry.notes || '';
        
        const dateObj = new Date(dateKey + 'T00:00:00');
        modalTitleEl.textContent = `Editing ${dateObj.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;

        timeHoursInput.classList.remove('invalid');
        timeMinutesInput.classList.remove('invalid');

        modal.classList.add('visible');
        timeHoursInput.focus();
    }

    document.body.classList.remove('modal-open');
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

    function renderMedals() {
        medalsListContainer.innerHTML = ''; // Clear the list first

        const completedMonthsCount = medals.completedMonths.length;

        if (completedMonthsCount > 0) {
            const medalRow = document.createElement('div');
            medalRow.className = 'medal-row';
            medalRow.innerHTML = `
                <div class="medal-icon">👍</div>
                <div>Completed month goal</div>
                <div class="medal-count">x${completedMonthsCount}</div>
            `;
            medalsListContainer.appendChild(medalRow);
        } else {
            medalsListContainer.innerHTML = '<p style="text-align: center; margin-top: 2rem;">No medals earned yet. Keep going!</p>';
        }

        const completedYearsCount = medals.completedYears.length;

        if (completedYearsCount > 0) {
            const trophyRow = document.createElement('div');
            trophyRow.className = 'medal-row';
            trophyRow.innerHTML = `
                <div class="medal-icon">🏆</div>
                <div>Completed service year goal</div>
                <div class="medal-count">x${completedYearsCount}</div>
            `;
            medalsListContainer.appendChild(trophyRow);
        }
        // Future medals will be added here
    }

    function openMedalsPanel() {
        renderMedals(); // Populate with the latest data
        medalsPanel.classList.add('visible');
    }

    function closeMedalsPanel() {
        medalsPanel.classList.remove('visible');
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
        const schedule = settings.schedule || {};
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        days.forEach(day => {
            const dayData = schedule[day] || {};
            const checkbox = document.querySelector(`#schedule-panel input[data-day="${day}"]`);
            const hoursInput = document.getElementById(`schedule-hours-${day.toLowerCase()}`);
            const minutesInput = document.getElementById(`schedule-minutes-${day.toLowerCase()}`);

            checkbox.checked = dayData.active || false;
            hoursInput.value = dayData.hours || '';
            minutesInput.value = dayData.minutes || '';
        });
        schedulePanel.classList.add('visible');
    }
    
    function closeSchedulePanel() {
        schedulePanel.classList.remove('visible');
    }
    
    function saveSchedule() {
        const newSchedule = {};
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        days.forEach(day => {
            const checkbox = document.querySelector(`#schedule-panel input[data-day="${day}"]`);
            const hours = parseInt(document.getElementById(`schedule-hours-${day.toLowerCase()}`).value) || 0;
            const minutes = parseInt(document.getElementById(`schedule-minutes-${day.toLowerCase()}`).value) || 0;
            if (checkbox.checked) {
                newSchedule[day] = { active: true, hours, minutes };
            } else {
                newSchedule[day] = { active: false, hours: 0, minutes: 0 };
            }
        });
        settings.schedule = newSchedule;
        saveSettings();
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
    // Listen for messages from the service worker (e.g., to open the modal)
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.action === 'open-modal-for-today') {
            const today = new Date();
            const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            openModal(dateKey);
        }
    });
    
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
    viewMedalsBtn.addEventListener('click', openMedalsPanel);
    medalsBackBtn.addEventListener('click', closeMedalsPanel);
    shareOptionBtn.addEventListener('click', openSharePanel);
    shareWithFriendBtn.addEventListener('click', shareApp);
    shareBackBtn.addEventListener('click', closeSharePanel);
    alertOkBtn.addEventListener('click', closeAlertModal);
    setGoalsBtn.addEventListener('click', openGoalPanel);
    notificationsBtn.addEventListener('click', openNotificationsPanel);
    notificationsBackBtn.addEventListener('click', closeNotificationsPanel);
    notificationsToggle.addEventListener('change', handleNotificationsToggle);
    notificationTimeInput.addEventListener('change', saveNotificationSettings);

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