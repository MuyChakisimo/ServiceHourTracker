document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENT SELECTORS ---
    const textColorPicker = document.getElementById('text-color-picker');
    const cardBgColorPicker = document.getElementById('card-bg-color-picker');
    const borderColorPicker = document.getElementById('border-color-picker');
    const backgroundColorPicker = document.getElementById('background-color-picker');
    const themeBtn = document.getElementById('theme-btn');
    const themePanel = document.getElementById('theme-panel');
    const themeBackBtn = document.getElementById('theme-back-btn');
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
    const yearAccumulatedHoursEl = document.getElementById('year-accumulated-hours');
    const yearRemainingHoursEl = document.getElementById('year-remaining-hours');
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
    const defaultSettings = {
        monthGoal: 50,
        yearGoal: 600,
        schedule: {},
        notifications: { enabled: false, time: '12:00' },
        customTheme: {
            '--text-color': '#e0aaff',
            '--card-bg-color': '#240046',
            '--border-color': '#5a189a',
            '--background-color': '#000000'
        }
    };
    const defaultMedals = {
        completedMonths: [],
        completedYears: []
    };

    let currentDate = new Date();
    let currentlyEditingDate = null;
    let deferredPrompt;
    
    let database = JSON.parse(localStorage.getItem('serviceTimeTrackerDB')) || {};
    let settings = { ...defaultSettings, ...JSON.parse(localStorage.getItem('serviceTimeTrackerSettings')) };
    let medals = { ...defaultMedals, ...JSON.parse(localStorage.getItem('serviceTimeTrackerMedals')) };
    
    // --- HELPER FUNCTIONS ---
    function formatMinutesToDisplay(totalMinutes) {
        if (!totalMinutes && totalMinutes !== 0) return '0h 0min';
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${minutes}min`;
    }

    function getServiceYear(date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        return month >= 8 ? year : year - 1;
    }

    function migrateScheduleData() {
        if (!settings.schedule) return;
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const needsMigration = days.some(day => settings.schedule[day]);

        if (needsMigration) {
            console.log('Old schedule data found. Migrating to new format...');
            const newSchedule = {};
            for (const day of days) {
                if (settings.schedule[day]) {
                    newSchedule[day.toLowerCase()] = settings.schedule[day];
                }
            }
            settings.schedule = newSchedule;
            saveSettings();
        }
    }

    // --- CORE APP INITIALIZATION ---
    function init() {
        migrateScheduleData();
        loadCustomTheme();
        renderCalendar();
        updateSummary();
    }

    // --- DATA PERSISTENCE ---
    function saveData() {
        localStorage.setItem('serviceTimeTrackerDB', JSON.stringify(database));
    }
    function saveSettings() {
        localStorage.setItem('serviceTimeTrackerSettings', JSON.stringify(settings));
    }
    function saveMedals() {
        localStorage.setItem('serviceTimeTrackerMedals', JSON.stringify(medals));
    }

    // --- THEME FUNCTIONS ---
    function applyCustomTheme(theme) {
        const root = document.documentElement;
        Object.keys(theme).forEach(key => {
            root.style.setProperty(key, theme[key]);
        });
    }

    function loadCustomTheme() {
        if (settings.customTheme) {
            applyCustomTheme(settings.customTheme);
        }
    }

    // --- UI & CORE LOGIC ---
    function updateSummary() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const serviceYearStartYear = getServiceYear(new Date());
        const serviceYearStartDate = new Date(serviceYearStartYear, 8, 1);

        let monthTotalMinutes = 0, monthTotalStudies = 0, yearTotalMinutes = 0;

        for (const dateKey in database) {
            const entryDate = new Date(dateKey + 'T00:00:00');
            const entry = database[dateKey];
            
            if (entryDate.getFullYear() === year && entryDate.getMonth() === month) {
                monthTotalMinutes += entry.time || 0;
                monthTotalStudies += entry.studies || 0;
            }
            if (entryDate >= serviceYearStartDate) {
                yearTotalMinutes += entry.time || 0;
            }
        }

        // --- Update Month Summary ---
        monthTotalHoursEl.textContent = formatMinutesToDisplay(monthTotalMinutes);
        monthTotalStudiesEl.textContent = monthTotalStudies;
        
        const monthlyGoalMinutes = settings.monthGoal * 60;
        const monthMinutesLeft = Math.max(0, monthlyGoalMinutes - monthTotalMinutes);
        const monthPercentComplete = monthlyGoalMinutes > 0 ? (monthTotalMinutes / monthlyGoalMinutes) * 100 : 0;

        monthGoalEl.textContent = settings.monthGoal;
        monthTimeLeftEl.textContent = formatMinutesToDisplay(monthMinutesLeft);
        monthProgressBar.style.width = `${Math.min(monthPercentComplete, 100)}%`;
        monthProgressText.textContent = `${monthPercentComplete.toFixed(0)}%`;
        monthGoalEmoji.classList.toggle('complete', monthPercentComplete >= 100);
        monthGoalEmoji.classList.toggle('incomplete', monthPercentComplete < 100);

        // --- Update Year Summary ---
        const startYearShort = serviceYearStartYear.toString().slice(-2);
        const endYearShort = (serviceYearStartYear + 1).toString().slice(-2);
        serviceYearTitleEl.textContent = `Service Year ${startYearShort}/${endYearShort}`;

        const yearlyGoalMinutes = settings.yearGoal * 60;
        const yearMinutesLeft = Math.max(0, yearlyGoalMinutes - yearTotalMinutes);
        const yearPercentComplete = yearlyGoalMinutes > 0 ? (yearTotalMinutes / yearlyGoalMinutes) * 100 : 0;
        
        yearAccumulatedHoursEl.textContent = formatMinutesToDisplay(yearTotalMinutes);
        yearGoalEl.textContent = settings.yearGoal;
        yearRemainingHoursEl.textContent = formatMinutesToDisplay(yearMinutesLeft);
        yearProgressBar.style.width = `${Math.min(yearPercentComplete, 100)}%`;
        yearProgressText.textContent = `${yearPercentComplete.toFixed(0)}%`;
        yearGoalEmoji.classList.toggle('trophy-glow', yearPercentComplete >= 100);
        yearGoalEmoji.classList.toggle('incomplete', yearPercentComplete < 100);

        // --- Medal Awarding Logic ---
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (monthPercentComplete >= 100 && !medals.completedMonths.includes(monthKey)) {
            medals.completedMonths.push(monthKey);
            saveMedals();
            openAlertModal('Congratulations! You completed your monthly goal and earned a medal!');
        }

        if (yearPercentComplete >= 100 && !medals.completedYears.includes(serviceYearStartYear)) {
            medals.completedYears.push(serviceYearStartYear);
            saveMedals();
            openAlertModal('Amazing! You completed your service year goal and earned a trophy!');
        }
    }

    function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        currentMonthYearEl.textContent = currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        calendarGridEl.innerHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay();

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < firstDayOfMonth; i++) {
            const paddingDay = document.createElement('div');
            paddingDay.className = 'calendar-day padding';
            fragment.appendChild(paddingDay);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day';

            const dayDate = new Date(year, month, i);
            const dateKey = dayDate.toISOString().split('T')[0];
            dayEl.dataset.date = dateKey;

            if (dayDate.getTime() === today.getTime()) {
                dayEl.classList.add('today');
            }

            const dayOfWeek = dayDate.getDay();
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayName = dayNames[dayOfWeek];
            const daySchedule = settings.schedule[dayName] || {};
            const plannedMinutes = (daySchedule.hours * 60) + (daySchedule.minutes || 0);
            const actualMinutes = database[dateKey]?.time || 0;

            if (plannedMinutes > 0) {
                if (actualMinutes >= plannedMinutes) {
                    dayEl.classList.add('complete');
                } else if (dayDate < today) {
                    dayEl.classList.add(actualMinutes > 0 ? 'under' : 'missed');
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
            if (entry?.notes?.trim()) {
                const noteIcon = document.createElement('span');
                noteIcon.className = 'note-indicator';
                noteIcon.textContent = '📝';
                dayHeader.appendChild(noteIcon);
            }
            
            dayEl.appendChild(dayHeader);
            
            if (plannedMinutes > 0 || actualMinutes > 0) {
                const summary = document.createElement('div');
                summary.className = 'day-summary';
                let summaryContent = '';
                if (plannedMinutes > 0) summaryContent += `🎯: ${formatMinutesToDisplay(plannedMinutes)}`;
                if (plannedMinutes > 0 && actualMinutes > 0) summaryContent += '<hr class="day-summary-divider">';
                if (actualMinutes > 0) summaryContent += `⏱️: ${formatMinutesToDisplay(actualMinutes)}`;
                summary.innerHTML = summaryContent;
                dayEl.appendChild(summary);
            }
            fragment.appendChild(dayEl);
        }
        calendarGridEl.appendChild(fragment);
        updateSummary();
    }

    // --- MODAL & PANEL FUNCTIONS ---
    function openNotificationsPanel() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const notificationSettings = document.querySelectorAll('#notifications-panel .setting-row');
        const iosMessage = document.getElementById('ios-notification-message');

        if (isIOS) {
            notificationSettings.forEach(el => el.style.display = 'none');
            if (iosMessage) iosMessage.style.display = 'block';
        } else {
            notificationSettings.forEach(el => el.style.display = 'flex');
            if (iosMessage) iosMessage.style.display = 'none';

            if (!settings.notifications) settings.notifications = {};
            notificationsToggle.checked = settings.notifications.enabled || false;
            notificationTimeInput.value = settings.notifications.time || '12:00';
        }
        notificationsPanel.classList.add('visible');
    }

    function closeNotificationsPanel() {
        notificationsPanel.classList.remove('visible');
    }

    function openThemePanel() {
        const theme = settings.customTheme;
        textColorPicker.value = theme['--text-color'];
        cardBgColorPicker.value = theme['--card-bg-color'];
        borderColorPicker.value = theme['--border-color'];
        backgroundColorPicker.value = theme['--background-color'];
        themePanel.classList.add('visible');
    }

    function closeThemePanel() {
        themePanel.classList.remove('visible');
    }

    async function saveNotificationSettings() {
        if (!settings.notifications) settings.notifications = {};
        settings.notifications.enabled = notificationsToggle.checked;
        settings.notifications.time = notificationTimeInput.value;
        saveSettings();

        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                action: 'updateSettings',
                settings: settings
            });
        }
        
        try {
            const registration = await navigator.serviceWorker.ready;
            if (settings.notifications.enabled) {
                await registration.periodicSync.register('check-reminder', { minInterval: 24 * 60 * 60 * 1000 });
            } else {
                await registration.periodicSync.unregister('check-reminder');
            }
        } catch (error) {
            console.error('Periodic Sync operation failed:', error);
            openAlertModal('Reminders could not be set up. Your device may not support background tasks.');
        }
    }

    function handleNotificationsToggle() {
        if (notificationsToggle.checked) {
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        saveNotificationSettings();
                    } else {
                        notificationsToggle.checked = false;
                    }
                });
            } else if (Notification.permission === 'denied') {
                openAlertModal('Notification permission was previously denied. Please enable it in your browser settings.');
                notificationsToggle.checked = false;
            } else {
                saveNotificationSettings();
            }
        } else {
            saveNotificationSettings();
        }
    }

    function openModal(dateKey) {
        document.body.classList.add('modal-open');
        currentlyEditingDate = dateKey;
        const entry = database[dateKey] || {};
        const totalMinutes = entry.time || 0;
        timeHoursInput.value = totalMinutes > 0 ? Math.floor(totalMinutes / 60) : '';
        timeMinutesInput.value = totalMinutes > 0 ? totalMinutes % 60 : '';
        studiesInput.value = entry.studies || '';
        notesInput.value = entry.notes || '';
        const dateObj = new Date(dateKey + 'T00:00:00');
        modalTitleEl.textContent = `Editing ${dateObj.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
        timeHoursInput.classList.remove('invalid');
        timeMinutesInput.classList.remove('invalid');
        modal.classList.add('visible');
        timeHoursInput.focus();
    }

    function closeModal() {
        document.body.classList.remove('modal-open');
        modal.classList.remove('visible');
        currentlyEditingDate = null;
    }

    function saveModalData() {
        if (!currentlyEditingDate) return;
        const hours = parseInt(timeHoursInput.value) || 0;
        const minutes = parseInt(timeMinutesInput.value) || 0;

        if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) {
            openAlertModal("Invalid time. Please enter a value up to 24h 00min, with minutes less than 60.");
            timeHoursInput.classList.add('invalid');
            timeMinutesInput.classList.add('invalid');
            return;
        }

        database[currentlyEditingDate] = {
            time: (hours * 60) + minutes,
            studies: parseInt(studiesInput.value) || 0,
            notes: notesInput.value.trim()
        };
        saveData();
        renderCalendar();
        closeModal();
    }
    
    function openAlertModal(message) {
        alertMessage.textContent = message;
        alertModal.classList.add('visible');
    }

    function closeAlertModal() {
        alertModal.classList.remove('visible');
    }

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
        medalsListContainer.innerHTML = '';
        const { completedMonths, completedYears } = medals;
        const completedMonthsCount = completedMonths.length;
        const completedYearsCount = completedYears.length;

        if (completedMonthsCount > 0) {
            const medalRow = document.createElement('div');
            medalRow.className = 'medal-row';
            medalRow.innerHTML = `<div class="medal-icon">👍</div><div>Completed month goal</div><div class="medal-count">x${completedMonthsCount}</div>`;
            medalsListContainer.appendChild(medalRow);
        }
        if (completedYearsCount > 0) {
            const trophyRow = document.createElement('div');
            trophyRow.className = 'medal-row';
            trophyRow.innerHTML = `<div class="medal-icon">🏆</div><div>Completed service year goal</div><div class="medal-count">x${completedYearsCount}</div>`;
            medalsListContainer.appendChild(trophyRow);
        }
        if (completedMonthsCount === 0 && completedYearsCount === 0) {
            medalsListContainer.innerHTML = '<p style="text-align: center; margin-top: 2rem;">No medals earned yet. Keep going!</p>';
        }
    }

    function openMedalsPanel() {
        renderMedals();
        medalsPanel.classList.add('visible');
    }

    function closeMedalsPanel() {
        medalsPanel.classList.remove('visible');
    }

    function exportData() {
        const dataToExport = { database, settings, medals };
        const dataStr = JSON.stringify(dataToExport, null, 2);
        const dataBlob = new Blob([dataStr], {type: "application/json"});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.download = `serviceTimeTracker_backup_${new Date().toISOString().split('T')[0]}.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        openAlertModal('Backup file has been downloaded!');
    }

    function importData(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (importedData.database && importedData.settings) {
                    if (confirm("This will overwrite all current data. Are you sure you want to continue?")) {
                        database = importedData.database;
                        settings = { ...defaultSettings, ...importedData.settings };
                        medals = { ...defaultMedals, ...importedData.medals };
                        saveData();
                        saveSettings();
                        saveMedals();
                        init();
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
        event.target.value = null;
    }

    function shareApp() {
        if (navigator.share) {
            navigator.share({
                title: 'Service Time Tracker',
                text: 'Check out this app for tracking service time!',
                url: 'https://muychakisimo.github.io/ServiceHourTracker/'
            }).catch(error => console.log('Error sharing', error));
        } else {
            openAlertModal('Share feature not supported on this browser.');
        }
    }

    function openSchedulePanel() {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        days.forEach(day => {
            const dayKey = day.toLowerCase();
            const dayData = settings.schedule[dayKey] || {};
            const checkbox = document.querySelector(`#schedule-check-${dayKey}`);
            const hoursInput = document.getElementById(`schedule-hours-${dayKey}`);
            const minutesInput = document.getElementById(`schedule-minutes-${dayKey}`);
            if (checkbox) checkbox.checked = dayData.active || false;
            if (hoursInput) hoursInput.value = dayData.hours || '';
            if (minutesInput) minutesInput.value = dayData.minutes || '';
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
            const dayKey = day.toLowerCase();
            const checkbox = document.querySelector(`#schedule-check-${dayKey}`);
            const hours = parseInt(document.getElementById(`schedule-hours-${dayKey}`).value) || 0;
            const minutes = parseInt(document.getElementById(`schedule-minutes-${dayKey}`).value) || 0;
            
            newSchedule[dayKey] = { 
                active: checkbox.checked, 
                hours: checkbox.checked ? hours : 0, 
                minutes: checkbox.checked ? minutes : 0 
            };
        });
        settings.schedule = newSchedule;
        saveSettings();
        renderCalendar();
        closeSchedulePanel();
    }

    function openGoalPanel() {
        monthlyGoalInput.value = settings.monthGoal;
        yearlyGoalInput.value = settings.yearGoal;
        goalPanel.classList.add('visible');
    }

    function closeGoalPanel() {
        goalPanel.classList.remove('visible');
    }

    function saveGoals() {
        const newMonthlyGoal = parseFloat(monthlyGoalInput.value) || 0;
        const newYearlyGoal = parseFloat(yearlyGoalInput.value) || 0;

        if (newMonthlyGoal < 0 || newYearlyGoal < 0) {
            openAlertModal('Please enter valid, positive numbers for both goals.');
            return;
        }

        settings.monthGoal = newMonthlyGoal;
        settings.yearGoal = newYearlyGoal;
        saveSettings();
        updateSummary();
        closeGoalPanel();
    }

    // --- EVENT LISTENERS & INITIALIZATION ---
    function setupEventListeners() {
        // Helper function to safely add listeners
        const safeAddEventListener = (element, event, handler) => {
            if (element) {
                element.addEventListener(event, handler);
            } else {
                // If an element is missing, log an error to help debug
                console.error(`Error: Element not found for an event listener. Check your HTML and JS!`);
            }
        };

        // --- Panel Navigation ---
        safeAddEventListener(optionsBtn, 'click', openOptionsPanel);
        safeAddEventListener(optionsCloseBtn, 'click', closeOptionsPanel);
        safeAddEventListener(planScheduleBtn, 'click', openSchedulePanel);
        safeAddEventListener(scheduleCancelBtn, 'click', closeSchedulePanel);
        safeAddEventListener(setGoalsBtn, 'click', openGoalPanel);
        safeAddEventListener(goalCancelBtn, 'click', closeGoalPanel);
        safeAddEventListener(viewMedalsBtn, 'click', openMedalsPanel);
        safeAddEventListener(medalsBackBtn, 'click', closeMedalsPanel);
        safeAddEventListener(shareOptionBtn, 'click', openSharePanel);
        safeAddEventListener(shareBackBtn, 'click', closeSharePanel);
        safeAddEventListener(notificationsBtn, 'click', openNotificationsPanel);
        safeAddEventListener(notificationsBackBtn, 'click', closeNotificationsPanel);
        safeAddEventListener(themeBtn, 'click', openThemePanel);
        safeAddEventListener(themeBackBtn, 'click', closeThemePanel);
        safeAddEventListener(importExportBtn, 'click', openImportExportPanel);
        safeAddEventListener(importExportBackBtn, 'click', closeImportExportPanel);

        // --- Data Actions ---
        safeAddEventListener(scheduleSaveBtn, 'click', saveSchedule);
        safeAddEventListener(goalSaveBtn, 'click', saveGoals);
        safeAddEventListener(modalSaveBtn, 'click', saveModalData);
        safeAddEventListener(exportDataBtn, 'click', exportData);
        safeAddEventListener(importFileInput, 'change', importData);
        
        // --- Theme Pickers (Optimized) ---
        const themePickers = {
            '--text-color': textColorPicker,
            '--card-bg-color': cardBgColorPicker,
            '--border-color': borderColorPicker,
            '--background-color': backgroundColorPicker
        };
        Object.entries(themePickers).forEach(([key, picker]) => {
            safeAddEventListener(picker, 'input', () => {
                settings.customTheme[key] = picker.value;
                applyCustomTheme(settings.customTheme);
                saveSettings();
            });
        });

        // --- Notifications ---
        safeAddEventListener(notificationsToggle, 'change', handleNotificationsToggle);
        safeAddEventListener(notificationTimeInput, 'change', saveNotificationSettings);
        
        // --- Calendar & Modals ---
        safeAddEventListener(prevMonthBtn, 'click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        });
        safeAddEventListener(nextMonthBtn, 'click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        });
        safeAddEventListener(calendarGridEl, 'click', (event) => {
            const dayElement = event.target.closest('.calendar-day');
            if (dayElement && !dayElement.classList.contains('padding')) {
                openModal(dayElement.dataset.date);
            }
        });
        safeAddEventListener(modalCloseBtn, 'click', closeModal);
        safeAddEventListener(modal, 'click', (event) => {
            if (event.target === modal) closeModal();
        });
        safeAddEventListener(alertOkBtn, 'click', closeAlertModal);

        // --- PWA & Sharing ---
        safeAddEventListener(shareWithFriendBtn, 'click', shareApp);
        safeAddEventListener(installBtn, 'click', () => {
            if (deferredPrompt) {
                installBanner.classList.remove('visible');
                deferredPrompt.prompt();
            }
        });
        safeAddEventListener(closeInstallBannerBtn, 'click', () => {
            installBanner.classList.remove('visible');
        });
        safeAddEventListener(iosInstallDoneBtn, 'click', () => {
            iosInstallModal.classList.remove('visible');
            localStorage.setItem('hasSeenIosInstallPrompt', 'true');
        });
    }

    function setupPwa() {
        // Service Worker Registration
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./service-worker.js')
                    .then(reg => console.log('ServiceWorker registration successful.', reg))
                    .catch(err => console.error('ServiceWorker registration failed:', err));
            });
        }

        // Custom Install Prompt Logic
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            installBanner.classList.add('visible');
        });
        
        // Listen for messages from the service worker
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.action === 'open-modal-for-today') {
                const today = new Date();
                const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                openModal(dateKey);
            }
        });
    }

    // --- APP INITIALIZATION ---
    setupEventListeners();
    setupPwa();
    init();
});