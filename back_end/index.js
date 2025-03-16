const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const basicAuth = require('express-basic-auth');
const app = express();
const jwt = require('jsonwebtoken');
require('dotenv').config();

const secretKey = process.env.SECRET_KEY // Replace with your own secret key

const MAX_RETRIES = 10;
const RETRY_DELAY = 5000; // 5 seconds

const bcrypt = require('bcrypt');
const saltRounds = 10;
const crypto = require('crypto');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendEmail } = require('./helpers/sendEmail');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });


let retryCount = 0;

app.use(express.json());       // to support JSON-encoded bodies
app.use(express.urlencoded({extended:true})); // to support URL-encoded bodies
app.use(cors({
    origin: '*', // This allows all origins. For more restrictive settings, you can specify particular origins.
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
const mysqlConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'admin',
    port: process.env.DB_PORT || '3306'
};

let connection;


const connectToDatabase = () => {
    connection = mysql.createConnection({ ...mysqlConfig, database: 'ecgannotation' });

    const connectWithRetry = () => {
        connection.connect(err => {
            if (err) {
                console.error('Error connecting to the database: ', err);
                retryCount++;
                
                if (retryCount <= MAX_RETRIES) {
                    console.log(`Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
                    setTimeout(connectWithRetry, RETRY_DELAY);
                } else {
                    console.error('Max retries reached. Could not connect to the database.');
                }
                
                return;
            }
            console.log('Connected to the MySQL database');
            createTables(); // Create tables after successful connection
        });
    };

    connectWithRetry();
};

const createDatabaseAndTables = () => {
    connection = mysql.createConnection(mysqlConfig);
    const databaseName = 'ecgannotation'    
    connection.query(`CREATE DATABASE IF NOT EXISTS ${databaseName}`, (err, results) => {
        if (err) {
            console.error('Error creating database:', err);
            return;
        }
        console.log('Database created successfully');
        connectToDatabase(); // Connect to the database after it's created
    });
};

const createTables = () => {
    const tables = {
        Comments: `
            CREATE TABLE IF NOT EXISTS Comments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ECGID INT,
                AnnID INT,
                Comment TEXT
            )`,
        AnnotationFirst: `
            CREATE TABLE IF NOT EXISTS AnnotationFirst (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ECGID INT,
                LeadID INT,
                PointIndex INT,
                PointType VARCHAR(255),
                userID INT,              -- New column for user ID
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, -- Timestamp for updates
                operation ENUM('add', 'delete') NOT NULL  -- New column for operation type
            )`,
        AnnotationSecond: `
            CREATE TABLE IF NOT EXISTS AnnotationSecond (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ECGID INT,
                LeadID INT,
                PointIndex INT,
                PointType VARCHAR(255)
            )`,
        AnnotationThird: `
            CREATE TABLE IF NOT EXISTS AnnotationThird (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ECGID INT,
                LeadID INT,
                PointIndex INT,
                PointType VARCHAR(255)
            )`,
        Users: `
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                verificationToken VARCHAR(255) DEFAULT NULL,
                isVerified BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                token TEXT,
                annotator_id INT DEFAULT 1
            )`,
        ecg_patient_info: `
            CREATE TABLE IF NOT EXISTS ecg_patient_info (
                id INT AUTO_INCREMENT PRIMARY KEY,
                filePath VARCHAR(255) NOT NULL,
                age INT NOT NULL,
                gender ENUM('male', 'female') NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
    };

    for (const [tableName, createTableQuery] of Object.entries(tables)) {
        connection.query(createTableQuery, (err, results) => {
            if (err) {
                console.error(`Error creating ${tableName} table:`, err);
                return;
            }
            console.log(`${tableName} table created successfully`);
        });
    }

    setTimeout(insertStaticUsers, 2000); // Delay to ensure tables are created before inserting users
};

const insertStaticUsers = async () => {
    const staticUsers = [
        { username: 'admin', email: 'admin@example.com', annotator_id: 5 },
        { username: 'checker', email: 'checker@example.com', annotator_id: 6 },
        { username: 'reader', email: 'reader@example.com', annotator_id: 8 },
        { username: 'annotator', email: 'annotator@example.com', annotator_id: 1 }
    ];

    for (const user of staticUsers) {
        try {
            const hashedPassword = await bcrypt.hash('F00Bar!', saltRounds);
            const checkQuery = 'SELECT id FROM Users WHERE username = ? OR email = ?';
            connection.query(checkQuery, [user.username, user.email], (err, results) => {
                if (err) {
                    console.error(`Error checking ${user.username}:`, err);
                    return;
                }
                if (results.length === 0) {
                    const insertQuery = 'INSERT INTO Users (username, email, password, annotator_id, isVerified) VALUES (?, ?, ?, ?, ?)';
                    connection.query(insertQuery, [user.username, user.email, hashedPassword, user.annotator_id, true], (err, results) => {                    
                        if (err) {
                            console.error(`Error inserting ${user.username}:`, err);
                        } else {
                            console.log(`${user.username} created successfully`);
                        }
                    });
                } else {
                    // console.log(`${user.username} already exists, skipping insertion`);
                }
            });
        } catch (err) {
            console.error(`Error hashing password for ${user.username}:`, err);
        }
    }
};

// Initialize the database and create tables
createDatabaseAndTables();


app.post('/register', (req, res) => {
    const { username, email, password } = req.body;

    // Check if username or email already exists
    connection.query('SELECT * FROM Users WHERE username = ? OR email = ?', [username, email], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ status: 500, msg: 'Database query failed.' });
        }

        if (results.length > 0) {
            // Check for existing username
            if (results.some(user => user.username === username)) {
                return res.status(400).json({ status: 400, msg: 'Username already exists.' });
            }
            // Check for existing email
            if (results.some(user => user.email === email)) {
                return res.status(400).json({ status: 400, msg: 'Email already exists.' });
            }
        }
        // Generate a verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Hash the password
        bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ status: 500, msg: 'Error hashing password.' });
            }

            const INSERT_USER_QUERY = 'INSERT INTO Users (username, email, password, verificationToken, isVerified) VALUES (?, ?, ?, ?, ?)';
            connection.query(INSERT_USER_QUERY, [username, email, hashedPassword, verificationToken, false], (err, results) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({ status: 500, msg: 'Failed to register user.' });
                } else {
                    console.log('User registered:', results);
                    // Send welcome email
                    const verificationLink = `http://localhost:3001/verify-email?token=${verificationToken}`;
                    sendEmail(email, 'Verify Your Email', 'verifyEmail', { username, verificationLink })
                    .then(() => {
                        return res.status(200).json({ status: 200, msg: 'User registered successfully.' });
                        }) 
                    .catch(error => {
                    console.error('Error sending email:', error);
                        return res.status(500).json({ status: 500, msg: 'User registered but failed to send email.' });
                });
                }
            });
        });
    });
});


app.get('/verify-email', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ status: 400, msg: 'Verification token is missing.' });
    }

    // Verify token and activate user
    connection.query('UPDATE Users SET isVerified = true, verificationToken = NULL WHERE verificationToken = ?', [token], (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ status: 500, msg: 'Database query failed.' });
        }

        if (results.affectedRows === 0) {
            return res.status(400).json({ status: 400, msg: 'Invalid or expired token.' });
        }
        return res.status(200).json({ status: 200, msg: 'Email verified successfully. You can now sign in.' });
    });
});


// Updated /authenticate route with dynamic user validation
app.post('/authenticate', (req, res) => {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    // Query to get user details
    const query = 'SELECT id, annotator_id, password, isVerified FROM Users WHERE username = ?';
    connection.query(query, [username], (err, results) => {
        if (err) {
            return res.status(500).send('Internal Server Error');
        }

        if (results.length === 0) {
            return res.status(404).send('Unknown user');
        }

        const user = results[0];

        const userId = user.id;
        const annotatorId = user.annotator_id;
        const passwordHash = user.password;
        const isVerified = user.isVerified;

        // Verify the password
        bcrypt.compare(password, passwordHash, (err, isMatch) => {
            if (err) {
                return res.status(500).send('Internal Server Error');
            }

            if (!isMatch) {
                return res.status(401).send('Invalid password');
            }

            if (isVerified === 0) {
                return res.status(403).json('Please verify your account before login');
            }

            // Create JWT token
            const token = jwt.sign({ userId, username, annotatorId }, secretKey, {});

            // Save the token in the Users table
            const updateTokenQuery = 'UPDATE Users SET token = ? WHERE id = ?';
            connection.query(updateTokenQuery, [token, userId], (err, result) => {
                if (err) {
                    return res.status(500).send('Failed to save token');
                }
                res.send({ data: annotatorId, token });
            });
        });
    });
});


app.post('/logout', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1]; // Extract the token from the Authorization header
    if (!token) {
        return res.status(401).send('No token provided');
    }

    try {
        // Decode the token to get the username
        const decoded = jwt.verify(token, secretKey);
        const username = decoded.username; // Assuming the token contains the username
        
        console.log('Logout username: ', username);

        // Remove the token from the database
        const removeTokenQuery = 'UPDATE Users SET token = NULL WHERE username = ?';
        connection.query(removeTokenQuery, [username], (err, result) => {
            console.log('result: ', result);
            if (err) {
                return res.status(500).send('Failed to remove token');
            }

            if (result.affectedRows === 0) {
                return res.status(404).send('User not found');
            }

            res.send({ success: true, message: 'Logged out successfully' });
        });

    } catch (err) {
        console.error('Failed to verify token:', err);
        return res.status(401).send('Invalid token');
    }
});


// Example in-memory token storage
let passwordResetTokens = {}; 

app.post('/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    console.log('req.body: ', req.body);

    const email = passwordResetTokens[token]; // Retrieve the associated email using the token

    if (!email) {
        return res.status(400).send({ status: 400, msg: 'Invalid or expired token' });
    }

    bcrypt.hash(newPassword, saltRounds, (err, hashedPassword) => {
        if (err) {
            return res.json({ status: 500, msg: 'Error hashing password' });
        }

        const UPDATE_PASSWORD_QUERY = 'UPDATE Users SET password = ? WHERE email = ?';
        connection.query(UPDATE_PASSWORD_QUERY, [hashedPassword, email], (err, results) => {
            if (err) {
                console.log(err);
                return res.json({ status: 500, msg: 'Error updating password' });
            }

            console.log('Password updated:', results);
            delete passwordResetTokens[token]; // Invalidate the token after use

            return res.json({ status: 200, msg: 'Password updated successfully' });
        });
    });
});


app.post('/forgot-password', (req, res) => {
    const { email } = req.body;

    const SELECT_USER_QUERY = 'SELECT * FROM Users WHERE email = ?';
    connection.query(SELECT_USER_QUERY, [email], (err, results) => {
        if (err || results.length === 0) {
            console.log(err);
            return res.json({ status: 404, msg: 'User not found' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        passwordResetTokens[token] = email; // Store the token with the associated email

        const verificationLink = `http://localhost:3001/reset-password?token=${token}`;
        const username = results[0].name || 'User'; // Replace with actual username field
        const company = 'ECGAnnotation'; // Replace with actual company name

        sendEmail(email, 'Forgot Password', 'forgotPassword', { username, verificationLink, company });
        return res.json({ status: 200, msg: 'Password reset link sent.please check your email' });
    });
});
  
// Insert Comment Method
app.post('/insertComment', function(req, res) {
    const ecgID = req.body.ecgID;
    console.log("🚀 ~ app.post ~  req.body:",  req.body)
    const comment = req.body.comment;
    const annID = req.body.annID; // Extract the 'data' field from 'annID'

    const INSERT_USER_QUERY = 'INSERT INTO Comments (ECGID, AnnID, Comment) VALUES (?, ?, ?)';
    console.log(`INSERT INTO Comments (ECGID, AnnID, Comment) VALUES (${ecgID}, ${annID}, ${comment})`);
    connection.query(INSERT_USER_QUERY, [ ecgID, annID, comment ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('Insert Hit');
});

app.post('/updateComment', function(req, res) {
    const ecgID = req.body.ecgID;
    const comment = req.body.comment;
    const annID = req.body.annID;

    const UPDATE_QUERY = 'UPDATE Comments SET Comment = ? WHERE ECGID = ? AND AnnID = ?';
    console.log(`INSERT INTO Comments (ECGID, AnnID, Comment) VALUES (${ecgID}, ${annID}, ${comment})`);
    connection.query(UPDATE_QUERY, [comment, ecgID, annID], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('Update Hit');
});

// Get Comment Method
app.get('/getComment', function (req, res) {

    const{ecgID, annID} = req.query;
    console.log("🚀 ~ req.query:", JSON.stringify(req.query));
    const SELECT_QUERY = 'SELECT * FROM Comments WHERE ECGID = ? AND AnnID = ?';
    console.log(`SELECT * FROM Comments WHERE ECGID = ${ecgID} AND AnnID = ${annID}`);

    connection.query(SELECT_QUERY, [ ecgID, annID ],  function (err, results) {
        if(err) {
            console.log(err);
            return res.send(err)
        } else {
            console.log(results)
            res.send(results);
        }
    })
});

// Insert Methods
app.post('/insertFirstAnnotator', function(req, res) {
    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;
    const pointType = req.body.pointType;

    const INSERT_USER_QUERY = 'INSERT INTO AnnotationFirst (ECGID, LeadID, PointIndex, PointType) VALUES (?, ?, ?, ?)';
    console.log(`INSERT INTO AnnotationFirst (ECGID, LeadID, PointIndex, PointType) VALUES (${ecgID}, ${leadID}, ${pointIndex}, ${pointType})`);
    connection.query(INSERT_USER_QUERY, [ ecgID, leadID, pointIndex, pointType ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('Insert Hit');
});

app.post('/insertSecondAnnotator', function(req, res) {
    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;
    const pointType = req.body.pointType;

    const INSERT_USER_QUERY = 'INSERT INTO AnnotationSecond (ECGID, LeadID, PointIndex, PointType) VALUES (?, ?, ?, ?)';
    console.log(`INSERT INTO AnnotationSecond (ECGID, LeadID, PointIndex, PointType) VALUES (${ecgID}, ${leadID}, ${pointIndex}, ${pointType})`);
    connection.query(INSERT_USER_QUERY, [ ecgID, leadID, pointIndex, pointType ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('Insert Hit');
});

app.post('/insertThirdAnnotator', function(req, res) {
    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;
    const pointType = req.body.pointType;

    const INSERT_USER_QUERY = 'INSERT INTO AnnotationThird (ECGID, LeadID, PointIndex, PointType) VALUES (?, ?, ?, ?)';
    console.log(`INSERT INTO AnnotationThird (ECGID, LeadID, PointIndex, PointType) VALUES (${ecgID}, ${leadID}, ${pointIndex}, ${pointType})`);
    connection.query(INSERT_USER_QUERY, [ ecgID, leadID, pointIndex, pointType ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('Insert Hit');
});


// Delete Methods

app.post('/deleteFirstAnnotator', function(req, res) {

    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;

    const DELETE_QUERY = 'DELETE FROM AnnotationFirst WHERE ECGID = ? AND LeadID = ? AND PointIndex = ?';
    console.log(`DELETE FROM AnnotationFirst (ECGID, LeadID, PointIndex) VALUES (${ecgID}, ${leadID}, ${pointIndex})`);
    connection.query(DELETE_QUERY, [ ecgID, leadID, pointIndex ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('DELETE Hit');
});

app.post('/deleteSecondAnnotator', function(req, res) {

    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;

    const DELETE_QUERY = 'DELETE FROM AnnotationSecond WHERE ECGID = ? AND LeadID = ? AND PointIndex = ?';

    connection.query(DELETE_QUERY, [ ecgID, leadID, pointIndex ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('DELETE Hit');
});

app.post('/deleteThirdAnnotator', function(req, res) {

    const ecgID = req.body.ecgID;
    const leadID = req.body.leadID;
    const pointIndex = req.body.pointIndex;

    const DELETE_QUERY = 'DELETE FROM AnnotationThird WHERE ECGID = ? AND LeadID = ? AND PointIndex = ?';

    connection.query(DELETE_QUERY, [ ecgID, leadID, pointIndex ], function(err, rows) {
        if(err) {
            console.log(err);
            res.json({'status': 402, 'msg': err});
        } else {
            console.log(rows);
            res.json({'status': 200, 'msg': rows});
        }
    });
    console.log('DELETE Hit');
});


var url = require( 'url' );
var queryString = require( 'querystring' );

app.get('/api/get', function (req, res) {

    var theUrl = url.parse( req.url );

    // gets the query part of the URL and parses it creating an object
    var queryObj = queryString.parse( theUrl.query );

    // queryObj will contain the data of the query as an object
    // and jsonData will be a property of it
    // so, using JSON.parse will parse the jsonData to create an object
    var obj = JSON.parse( queryObj.jsonData );

    console.log( obj.foo );

});



// Get Methods

app.get('/getFirstAnnotator', function (req, res) {

    const{ecgID, leadID, pointType} = req.query;
    const SELECT_QUERY = 'SELECT * FROM AnnotationFirst WHERE ECGID = ? AND LeadID = ? AND PointType = ?';
    console.log(`SELECT * FROM AnnotationFirst WHERE ECGID = ${ecgID} AND LeadID = ${leadID} AND PointType = ${pointType}`);
    console.log('Select Query Hit');

    connection.query(SELECT_QUERY, [ ecgID, leadID, pointType ],  function (err, results) {
        if(err) {
            console.log(err);
            return res.send(err)
        } else {
            console.log(results)
            res.send(results);
        }
    })
});

app.get('/getSecondAnnotator', function (req, res) {

    const{ecgID, leadID, pointType} = req.query;
    const SELECT_QUERY = 'SELECT * FROM AnnotationSecond WHERE ECGID = ? AND LeadID = ? AND PointType = ?';
    console.log(`SELECT * FROM AnnotationSecond WHERE ECGID = ${ecgID} AND LeadID = ${leadID} AND PointType = ${pointType}`);
    connection.query(SELECT_QUERY, [ ecgID, leadID, pointType ],  function (err, results) {
        if(err) {
            console.log(err);
            return res.send(err)
        } else {
            console.log(results)
            res.send(results);
            }
    })
});

app.get('/getThirdAnnotator', function (req, res) {

    const{ecgID, leadID, pointType} = req.query;
    const SELECT_QUERY = 'SELECT * FROM AnnotationThird WHERE ECGID = ? AND LeadID = ? AND PointType = ?';
    console.log(`SELECT * FROM AnnotationThird WHERE ECGID = ${ecgID} AND LeadID = ${leadID} AND PointType = ${pointType}`);
    connection.query(SELECT_QUERY, [ ecgID, leadID, pointType ],  function (err, results) {
        if(err) {
            console.log(err);
            return res.send(err)
        } else {
            console.log(results)
            res.send(results);
        }
    })
});



app.get('/api/getList', (req,res) => {
    var list = ["item1", "item2", "item3"];
    res.json(list);
    console.log('Sent list of items');
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 400, msg: 'No file uploaded' });
    }

    const { age, gender } = req.body;
    const filePath = req.file.path;

    if (!age || !gender) {
        return res.status(400).json({ status: 400, msg: 'Age and gender are required' });
    }

    if (!['male', 'female'].includes(gender)) {
        return res.status(400).json({ status: 400, msg: 'Invalid gender' });
    }

    const insertQuery = `
        INSERT INTO ecg_patient_info (filePath, age, gender)
        VALUES (?, ?, ?)
    `;

    connection.query(insertQuery, [filePath, parseInt(age, 10), gender], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ status: 500, msg: 'Database insertion error' });
        }
        res.status(200).json({ status: 200, msg: 'File uploaded and data saved successfully', file: req.file });
    });
});

// Starting the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
