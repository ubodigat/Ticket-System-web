// Login-Formular Überprüfung für Admin-Zugang
document.addEventListener("DOMContentLoaded", function() {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", function(event) {
            event.preventDefault();

            const username = document.getElementById("username").value;
            const password = document.getElementById("password").value;

            // Festgelegte Zugangsdaten
            const adminUsername = "admin";
            const adminPassword = "passwort123";

            // Überprüfen der Zugangsdaten
            if (username === adminUsername && password === adminPassword) {
                localStorage.setItem("isAdminLoggedIn", "true"); // Token setzen
                window.location.href = "admin.html"; // Weiterleitung zum Admin-Panel
            } else {
                alert("Falscher Benutzername oder Passwort.");
            }
        });
    }

    // Design-Umschaltung (Dunkel/Hell)
    const themeSwitch = document.getElementById("themeSwitch");
    if (themeSwitch) {
        // Initiales Thema laden
        const currentTheme = localStorage.getItem("theme") || "light";
        document.body.classList.add(currentTheme);

        // Umschaltung des Themas
        themeSwitch.checked = currentTheme === "dark"; // Checkbox Status setzen
        themeSwitch.addEventListener("change", function() {
            document.body.classList.toggle("dark");
            const newTheme = document.body.classList.contains("dark") ? "dark" : "light";
            localStorage.setItem("theme", newTheme); // Speichert das ausgewählte Thema
        });
    }

    // Überprüft den Admin-Zugriff, wenn die Seite "admin.html" aufgerufen wird
    function checkAdminAccess() {
        const isAdminLoggedIn = localStorage.getItem("isAdminLoggedIn");
        if (!isAdminLoggedIn) {
            window.location.href = "login.html"; // Weiterleitung zum Login
        }
    }

    // Nur auf admin.html die Zugangskontrolle ausführen
    if (window.location.pathname.includes("admin.html")) {
        checkAdminAccess();
    }

    // Funktion zum Abmelden
    window.logout = function() {
        localStorage.removeItem("isAdminLoggedIn");
        window.location.href = "login.html"; // Weiterleitung nach dem Logout
    };
});