const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e7 }); // Limite à 10 Mo pour les fichiers
const sqlite3 = require('sqlite3').verbose();

// Sert les fichiers du dossier public (HTML/CSS)
app.use(express.static(__dirname + '/public'));

// Connexion et création automatique de SQLite
const db = new sqlite3.Database('database.sqlite', (err) => {
    if (err) console.error("Erreur d'ouverture de la base de données :", err.message);
    else console.log('📁 Base de données SQLite connectée et prête.');
});

// Structure de la table des messages de l'historique
db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo TEXT,
    contenu TEXT,
    nomFichier TEXT,
    type TEXT,
    salon TEXT,
    heure TEXT
)`);

let utilisateurs = {};

io.on('connection', (socket) => {
    
    // Un utilisateur rejoint le chat
    socket.on('nouveau membre', (pseudo) => {
        utilisateurs[socket.id] = { pseudo: pseudo, salon: 'général' };
        socket.join('général');
        
        io.emit('liste membres', Object.values(utilisateurs));
        
        // Envoi de l'historique complet du salon par défaut
        db.all("SELECT * FROM messages WHERE salon = 'général' ORDER BY id ASC", [], (err, rows) => {
            if (!err) socket.emit('historique complet', rows);
        });
    });

    // Gestion du changement de salon
    socket.on('changer salon', (nouveauSalon) => {
        if (!utilisateurs[socket.id]) return;
        const ancienSalon = utilisateurs[socket.id].salon;
        socket.leave(ancienSalon);
        socket.join(nouveauSalon);
        utilisateurs[socket.id].salon = nouveauSalon;
        io.emit('liste membres', Object.values(utilisateurs));

        // Envoi de l'historique du nouveau salon
        db.all("SELECT * FROM messages WHERE salon = ? ORDER BY id ASC", [nouveauSalon], (err, rows) => {
            if (!err) socket.emit('historique complet', rows);
        });
    });

    // Réception d'un message (texte ou fichier)
    socket.on('chat message', (data) => {
        data.heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        
        // Sauvegarde éternelle dans SQLite
        const stmt = db.prepare("INSERT INTO messages (pseudo, contenu, nomFichier, type, salon, heure) VALUES (?, ?, ?, ?, ?, ?)");
        stmt.run(data.pseudo, data.contenu, data.nomFichier || '', data.type, data.salon, data.heure);
        stmt.finalize();

        // Expédition du message aux membres du salon en temps réel
        io.to(data.salon).emit('chat message', data);
    });

    // Indicateur de frappe
    socket.on('en train d\'ecrire', (data) => {
        socket.to(data.salon).emit('affichage ecriture', { pseudo: data.pseudo, statut: data.statut });
    });

    // Déconnexion d'un membre
    socket.on('disconnect', () => {
        if (utilisateurs[socket.id]) {
            delete utilisateurs[socket.id];
            io.emit('liste membres', Object.values(utilisateurs));
        }
    });
});

// Choix dynamique du port pour s'adapter aux hébergeurs web
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`⚡ CYBERCHAT SERVER ONLINE : http://localhost:${PORT}`);
});
