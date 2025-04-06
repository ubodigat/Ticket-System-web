function toggleRegister() {
    const register = document.getElementById("register-container");
    const login = document.querySelector(".container");

    if (register.style.display === "none") {
        login.style.display = "none";
        register.style.display = "block";
    } else {
        login.style.display = "block";
        register.style.display = "none";
    }
}

function register() {
    const username = document.getElementById("register-username").value;
    const password = document.getElementById("register-password").value;

    if (username && password) {
        localStorage.setItem(username, password);
        alert("Registrierung erfolgreich! Jetzt einloggen.");
        toggleRegister();
    } else {
        alert("Bitte alle Felder ausfüllen!");
    }
}

function login() {
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    const storedPassword = localStorage.getItem(username);

    if (storedPassword && storedPassword === password) {
        alert("Login erfolgreich!");
        localStorage.setItem("currentUser", username);
        window.location.href = "dashboard.html";
    } else {
        alert("Benutzername oder Passwort falsch!");
    }
}

function logout() {
    localStorage.removeItem("currentUser");
    window.location.href = "index.html";
}

function createTicket() {
    const title = document.getElementById("ticket-title").value;
    const description = document.getElementById("ticket-description").value;
    const user = localStorage.getItem("currentUser");

    if (title && description) {
        const tickets = JSON.parse(localStorage.getItem("tickets") || "[]");
        tickets.push({ title, description, status: "Offen", user });
        localStorage.setItem("tickets", JSON.stringify(tickets));
        alert("Ticket erstellt!");
        window.location.href = "dashboard.html";
    } else {
        alert("Bitte alle Felder ausfüllen!");
    }
}

function loadTickets() {
    const tickets = JSON.parse(localStorage.getItem("tickets") || "[]");
    const user = localStorage.getItem("currentUser");
    const container = document.getElementById("tickets-list");

    if (container) {
        tickets.filter(t => t.user === user).forEach(ticket => {
            const div = document.createElement("div");
            div.className = "ticket";
            div.innerHTML = `<h3>${ticket.title}</h3><p>${ticket.description}</p><p>Status: ${ticket.status}</p>`;
            container.appendChild(div);
        });
    }
}

function loadAdminTickets() {
    const tickets = JSON.parse(localStorage.getItem("tickets") || "[]");
    const container = document.getElementById("admin-tickets-list");

    if (container) {
        tickets.forEach((ticket, index) => {
            const div = document.createElement("div");
            div.className = "ticket";
            div.innerHTML = `
          <h3>${ticket.title}</h3>
          <p>${ticket.description}</p>
          <p>Status: ${ticket.status}</p>
          <button onclick="changeStatus(${index})">Status ändern</button>
        `;
            container.appendChild(div);
        });
    }
}

function changeStatus(index) {
    const tickets = JSON.parse(localStorage.getItem("tickets") || "[]");
    if (tickets[index].status === "Offen") {
        tickets[index].status = "In Bearbeitung";
    } else if (tickets[index].status === "In Bearbeitung") {
        tickets[index].status = "Erledigt";
    } else {
        tickets[index].status = "Offen";
    }
    localStorage.setItem("tickets", JSON.stringify(tickets));
    location.reload();
}

function toggleDarkMode() {
    if (document.body.classList.contains("darkmode")) {
        document.body.classList.remove("darkmode");
        document.body.classList.add("lightmode");
    } else {
        document.body.classList.remove("lightmode");
        document.body.classList.add("darkmode");
    }
}

window.onload = function() {
    if (!document.body.classList.contains("lightmode") && !document.body.classList.contains("darkmode")) {
        document.body.classList.add("darkmode");
    }
    loadTickets();
    loadAdminTickets();
}