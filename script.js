document.addEventListener('DOMContentLoaded', function() {
            const ticketForm = document.getElementById('ticketForm');
            const loginForm = document.getElementById('loginForm');
            const ticketsTable = document.getElementById('ticketsTable');
            const loginError = document.getElementById('loginError');
            const settingsButton = document.getElementById('settingsButton');
            const colorPickerModal = document.getElementById('colorPickerModal');
            const closeButton = colorPickerModal.querySelector('.close-button');
            const colorCircles = document.querySelectorAll('.color-circle');
            const colorPicker = document.getElementById('colorPickerInput');
            const applyColorButton = document.getElementById('applyColorButton');

            const validAdmins = {
                'admin': 'admin123',
                'simon': 'test123',
                'tim': '333'
            };

            let tickets = JSON.parse(localStorage.getItem('tickets')) || [];
            let ticketId = tickets.length ? tickets[tickets.length - 1].id + 1 : 1;

            if (ticketForm) {
                ticketForm.addEventListener('submit', function(e) {
                    e.preventDefault();

                    const ticket = {
                        id: ticketId++,
                        name: document.getElementById('username').value,
                        email: document.getElementById('email').value,
                        issue: document.getElementById('issue').value,
                        status: 'offen',
                        assignedTo: ''
                    };

                    tickets.push(ticket);
                    localStorage.setItem('tickets', JSON.stringify(tickets));
                    displaySuccessMessage('Ticket erfolgreich erstellt!');
                    loadTickets(); // Tabelle aktualisieren
                    this.reset();
                });
            }

            if (loginForm) {
                loginForm.addEventListener('submit', function(e) {
                    e.preventDefault();

                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;

                    loginError.classList.add('hidden');

                    if (validAdmins[username] === password) {
                        sessionStorage.setItem('loggedIn', 'true');
                        window.location.href = 'admin-panel.html'; // Weiterleitung zum Admin-Panel
                    } else {
                        loginError.classList.remove('hidden');
                    }
                });
            }

            if (ticketsTable) {
                if (!sessionStorage.getItem('loggedIn')) {
                    window.location.href = 'admin.html';
                } else {
                    loadTickets();
                }
            }

            if (document.body) {
                document.body.addEventListener('click', function(e) {
                    if (e.target.classList.contains('view-details')) {
                        const ticketId = parseInt(e.target.getAttribute('data-id'));
                        showTicketDetails(ticketId);
                    }
                });
            }

            function loadTickets() {
                const tbody = document.querySelector('#ticketsTable tbody');
                if (!tbody) {
                    console.error('Element #ticketsTable tbody wurde nicht gefunden.');
                    return;
                }
                tbody.innerHTML = '';

                tickets
                    .slice()
                    .reverse()
                    .forEach(ticket => {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                <td>${ticket.id}</td>
                <td>${ticket.name}</td>
                <td>${ticket.email}</td>
                <td>${ticket.issue}</td>
                <td><span class="status ${ticket.status}">${ticket.status}</span></td>
                <td>
                    <select onchange="assignTicket(${ticket.id}, this.value)">
                        <option value="">Zuordnen</option>
                        ${Object.keys(validAdmins).map(admin => `<option value="${admin}">${admin}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <button onclick="updateStatus(${ticket.id}, 'in-progress')">In Bearbeitung</button>
                    <button onclick="updateStatus(${ticket.id}, 'abgeschlossen')">Abgeschlossen</button>
                    <button onclick="deleteTicket(${ticket.id})">Löschen</button>
                    <button class="view-details" data-id="${ticket.id}">Details</button>
                </td>
            `;
                tbody.appendChild(row);
            });
    }

    function deleteTicket(id) {
        tickets = tickets.filter(ticket => ticket.id !== id);
        localStorage.setItem('tickets', JSON.stringify(tickets));
        loadTickets(); // Tabelle nach dem Löschen aktualisieren
    }

    function updateStatus(id, status) {
        const ticket = tickets.find(ticket => ticket.id === id);
        if (ticket) {
            ticket.status = status;
            localStorage.setItem('tickets', JSON.stringify(tickets));
            loadTickets(); // Tabelle nach der Statusänderung aktualisieren
        }
    }

    function assignTicket(id, person) {
        const ticket = tickets.find(ticket => ticket.id === id);
        if (ticket) {
            ticket.assignedTo = person;
            localStorage.setItem('tickets', JSON.stringify(tickets));
            loadTickets(); // Tabelle nach der Zuordnung aktualisieren
        }
    }

    function showTicketDetails(id) {
        const ticket = tickets.find(ticket => ticket.id === id);
        if (ticket) {
            const detailContainer = document.createElement('div');
            detailContainer.id = 'ticketDetailModal';
            detailContainer.className = 'modal';

            detailContainer.innerHTML = `
                <div class="modal-content">
                    <span class="close-button" onclick="closeModal()">&times;</span>
                    <h2>Ticket Details</h2>
                    <p><strong>ID:</strong> ${ticket.id}</p>
                    <p><strong>Name:</strong> ${ticket.name}</p>
                    <p><strong>Email:</strong> ${ticket.email}</p>
                    <p><strong>Problem:</strong> ${ticket.issue}</p>
                    <p><strong>Status:</strong> <span class="status ${ticket.status}">${ticket.status}</span></p>
                    <p><strong>Zugewiesen an:</strong> ${ticket.assignedTo}</p>
                </div>
            `;

            document.body.appendChild(detailContainer);
        }
    }

    function closeModal() {
        const modal = document.getElementById('ticketDetailModal');
        if (modal) {
            modal.remove();
        }
    }

    function displaySuccessMessage(message) {
        const messageContainer = document.createElement('div');
        messageContainer.className = 'modal';

        messageContainer.innerHTML = `
            <div class="modal-content">
                <span class="close-button" onclick="closeModal()">&times;</span>
                <p>${message}</p>
            </div>
        `;

        document.body.appendChild(messageContainer);
    }

    if (settingsButton) {
        settingsButton.addEventListener('click', function() {
            colorPickerModal.classList.toggle('hidden');
        });
    } else {
        console.error('Einstellungen-Button wurde nicht gefunden.');
    }

    if (closeButton) {
        closeButton.addEventListener('click', function() {
            colorPickerModal.classList.add('hidden');
        });
    } else {
        console.error('Schließen-Button wurde nicht gefunden.');
    }

    if (colorCircles.length > 0) {
        colorCircles.forEach(circle => {
            circle.addEventListener('click', function() {
                document.body.style.backgroundColor = circle.style.backgroundColor;
                colorPickerModal.classList.add('hidden');
            });
        });
    } else {
        console.error('Farbkreise wurden nicht gefunden.');
    }

    if (applyColorButton) {
        applyColorButton.addEventListener('click', function() {
            const newColor = colorPicker.value;
            if (newColor) {
                document.body.style.backgroundColor = newColor;
                localStorage.setItem('backgroundColor', newColor);
                colorPickerModal.classList.add('hidden');
            }
        });
    } else {
        console.error('Farbe anwenden-Button wurde nicht gefunden.');
    }

    const savedColor = localStorage.getItem('backgroundColor');
    if (savedColor) {
        document.body.style.backgroundColor = savedColor;
    }
});