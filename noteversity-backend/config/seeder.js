const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Note = require('../models/Note');
const Pyq = require('../models/Pyq');
const Message = require('../models/Message');
const bcrypt = require('bcryptjs');
const libraryCatalog = require('./libraryCatalog');
const {
  USERS_FILE,
  NOTES_FILE,
  PYQS_FILE,
  readJson,
  syncUsersToJson,
  syncNotesToJson,
  syncPyqsToJson,
} = require('../services/jsonStore');

// Subjects retired from the platform — purged on every boot so only the 6
// catalog subjects (DAA, AI, AWS, EPJ, TOC, QR) remain.
const RETIRED_SUBJECTS = ['DBMS', 'OS', 'CN', 'DM'];

// Map of catalog subject code to upload filename prefix
const SUBJECT_PREFIX = {
  DAA: 'DAA_',
  AI: 'AI_',
  AWS: 'AWS_',
  EPJ: 'EPJ_',
  TOC: 'TOC_',
  QR: 'QR_'
};

function extractSubjectFromFilename(filename) {
  const upper = filename.toUpperCase();
  for (const [code, prefix] of Object.entries(SUBJECT_PREFIX)) {
    if (upper.startsWith(prefix)) return code;
  }
  return null;
}

function makeTitleFromFilename(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/_/g, ' ');
}

async function seedInitialData() {
  try {
    const adminPassHash = await bcrypt.hash('admin123', 10);

    // ── 1. USERS: Restore from users.json or seed defaults ──
    const existingUsersInJson = readJson(USERS_FILE, []);
    if (existingUsersInJson && existingUsersInJson.length > 0) {
      console.log(`[JSON Store] Restoring ${existingUsersInJson.length} users from users.json...`);
      for (const u of existingUsersInJson) {
        await User.findByIdAndUpdate(u._id, u, { upsert: true, new: true, setDefaultsOnInsert: true });
      }
    } else {
      // 1. Ensure demo admin exists
      let demoUser = await User.findOne({ email: 'admin@paruluniversity.ac.in' });
      if (!demoUser) {
        demoUser = await User.create({
          name: 'Parul Admin',
          email: 'admin@paruluniversity.ac.in',
          passwordHash: adminPassHash,
          rollNumber: '2113101',
          branch: 'Computer Science & Engineering',
          semester: 5,
          isVerified: true,
        });
        console.log('✓ Demo admin seeded: Parul Admin (admin@paruluniversity.ac.in)');
      } else if (!demoUser.passwordHash) {
        demoUser.passwordHash = adminPassHash;
        await demoUser.save();
      }

      // 2. Ensure peer user exists
      let peerUser = await User.findOne({ email: 'karan@paruluniversity.ac.in' });
      if (!peerUser) {
        peerUser = await User.create({
          name: 'Karan M.',
          email: 'karan@paruluniversity.ac.in',
          rollNumber: '2113102',
          branch: 'CSE',
          semester: 5,
          isVerified: true,
        });
      }

      let facultyUser = await User.findOne({ email: 'faculty@paruluniversity.ac.in' });
      if (!facultyUser) {
        facultyUser = await User.create({
          name: 'Faculty Notes',
          email: 'faculty@paruluniversity.ac.in',
          branch: 'CSE',
          semester: 5,
          isVerified: true,
        });
      }

      // Sync to JSON file
      await syncUsersToJson(User);
      console.log('✓ Initial users saved to data/users.json');
    }

    const demoUser = await User.findOne({ email: 'admin@paruluniversity.ac.in' });
    const peerUser = (await User.findOne({ email: 'karan@paruluniversity.ac.in' })) || demoUser;
    const facultyUser = (await User.findOne({ email: 'faculty@paruluniversity.ac.in' })) || demoUser;

    // ── 2. NOTES: Restore from notes.json or seed the real course library ──
    const existingNotesInJson = readJson(NOTES_FILE, []);
    if (existingNotesInJson && existingNotesInJson.length > 0) {
      console.log(`[JSON Store] Restoring ${existingNotesInJson.length} notes from notes.json...`);
      for (const n of existingNotesInJson) {
        await Note.findByIdAndUpdate(n._id, n, { upsert: true, new: true });
      }
    } else {
      const noteCount = await Note.countDocuments();
      if (noteCount === 0) {
        // Existence filter: only seed catalog entries whose PDF actually exists
        const availableNotes = libraryCatalog.notes.filter(entry =>
          fs.existsSync(path.join(__dirname, '..', 'uploads', entry.file))
        );
        if (availableNotes.length < libraryCatalog.notes.length) {
          console.log(`[Seeder] Skipping ${libraryCatalog.notes.length - availableNotes.length} catalog notes with missing PDFs`);
        }
        const initialNotes = availableNotes.map((entry, i) => ({
          title: entry.title,
          subject: entry.subject,
          branch: 'CSE',
          semester: 5,
          fileUrl: `/uploads/${entry.file}`,
          fileType: 'application/pdf',
          uploadedBy: facultyUser._id,
          downloads: 40 + ((i * 37) % 260),
        }));
        const createdNotes = await Note.insertMany(initialNotes);
        demoUser.downloadedNotes = [createdNotes[0]._id, createdNotes[1]._id, createdNotes[2]._id];
        await demoUser.save();
        await syncUsersToJson(User);
        await syncNotesToJson(Note);
        console.log(`✓ Seeded ${createdNotes.length} notes & saved to data/notes.json`);
      }
    }

    // ── 3. PYQs: Restore from pyqs.json or seed the real papers/question banks ──
    const existingPyqsInJson = readJson(PYQS_FILE, []);
    if (existingPyqsInJson && existingPyqsInJson.length > 0) {
      console.log(`[JSON Store] Restoring ${existingPyqsInJson.length} PYQs from pyqs.json...`);
      for (const p of existingPyqsInJson) {
        await Pyq.findByIdAndUpdate(p._id, p, { upsert: true, new: true });
      }
    } else {
      const pyqCount = await Pyq.countDocuments();
      if (pyqCount === 0) {
        // Existence filter: only seed catalog entries whose PDF actually exists
        const availablePyqs = libraryCatalog.pyqs.filter(entry =>
          fs.existsSync(path.join(__dirname, '..', 'uploads', entry.file))
        );
        if (availablePyqs.length < libraryCatalog.pyqs.length) {
          console.log(`[Seeder] Skipping ${libraryCatalog.pyqs.length - availablePyqs.length} catalog PYQs with missing PDFs`);
        }
        const initialPyqs = availablePyqs.map((entry, i) => ({
          title: entry.title,
          subject: entry.subject,
          branch: 'CSE',
          semester: 5,
          year: entry.year,
          examType: entry.examType,
          isSolved: entry.isSolved,
          fileUrl: `/uploads/${entry.file}`,
          uploadedBy: demoUser._id,
          downloads: 60 + ((i * 53) % 340),
        }));
        const createdPyqs = await Pyq.insertMany(initialPyqs);
        demoUser.downloadedPyqs = [createdPyqs[0]._id, createdPyqs[1]._id];
        await demoUser.save();
        await syncUsersToJson(User);
        await syncPyqsToJson(Pyq);
        console.log(`✓ Seeded ${createdPyqs.length} PYQs & saved to data/pyqs.json`);
      }
    }

    // ── 3b. Purge retired subjects / placeholder sample files (only-6-subjects policy) ──
    const purgedNotes = await Note.deleteMany({
      $or: [{ subject: { $in: RETIRED_SUBJECTS } }, { fileUrl: '/uploads/sample-document.pdf' }],
    });
    const purgedPyqs = await Pyq.deleteMany({
      $or: [{ subject: { $in: RETIRED_SUBJECTS } }, { fileUrl: '/uploads/sample-document.pdf' }],
    });
    if (purgedNotes.deletedCount || purgedPyqs.deletedCount) {
      await syncNotesToJson(Note);
      await syncPyqsToJson(Pyq);
      console.log(`✓ Purged retired content: ${purgedNotes.deletedCount} notes, ${purgedPyqs.deletedCount} PYQs`);
    }

    // ── 3c. Auto-import any PDFs dropped into uploads/ that aren't already cataloged ──
    const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
    if (fs.existsSync(UPLOADS_DIR)) {
      const allFiles = fs.readdirSync(UPLOADS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
      let importedNotes = 0, importedPyqs = 0;

      for (const file of allFiles) {
        // Skip sample document and already-cataloged files
        if (file === 'sample-document.pdf') continue;
        const inCatalog = libraryCatalog.notes.some(n => n.file === file) || libraryCatalog.pyqs.some(p => p.file === file);
        if (inCatalog) continue;

        // Skip files already in DB
        const noteExists = await Note.findOne({ fileUrl: `/uploads/${file}` });
        const pyqExists = await Pyq.findOne({ fileUrl: `/uploads/${file}` });
        if (noteExists || pyqExists) continue;

        // Determine subject from filename prefix
        const subject = extractSubjectFromFilename(file);
        if (!subject) {
          console.log(`[Auto-import] Unknown subject prefix for "${file}", skipping`);
          continue;
        }

        const title = makeTitleFromFilename(file);
        const fileUrl = `/uploads/${file}`;
        const fileType = 'application/pdf';
        const uploadedBy = facultyUser._id;

        // Heuristic: if filename looks like a PYQ (contains mid, exam, paper, question bank, solved)
        const looksLikePyq = /mid|exam|paper|qb|question.bank|solved/i.test(file);
        if (looksLikePyq) {
          const newPyq = await Pyq.create({
            title,
            subject,
            branch: 'CSE',
            semester: 5,
            year: new Date().getFullYear(),
            examType: /mid/i.test(file) ? 'MidSem1' : 'EndSem',
            isSolved: /solved/i.test(file),
            fileUrl,
            uploadedBy,
            downloads: 0,
          });
          importedPyqs++;
          console.log(`[Auto-import] PYQ added: ${title}`);
        } else {
          const newNote = await Note.create({
            title,
            subject,
            branch: 'CSE',
            semester: 5,
            fileUrl,
            fileType,
            uploadedBy,
            downloads: 0,
          });
          importedNotes++;
          console.log(`[Auto-import] Note added: ${title}`);
        }
      }

      if (importedNotes || importedPyqs) {
        await syncNotesToJson(Note);
        await syncPyqsToJson(Pyq);
        console.log(`✓ Auto-imported ${importedNotes} notes, ${importedPyqs} PYQs from uploads/`);
      }
    }

    // ── 4. Chat messages ──
    const messageCount = await Message.countDocuments();
    if (messageCount === 0) {
      const initialMessages = [
        {
          room: 'daa',
          sender: peerUser._id,
          text: 'Anyone has the derivation for the 0/1 knapsack recurrence? Confused about the base case.',
        },
        {
          room: 'daa',
          sender: demoUser._id,
          text: 'Yeah, I uploaded a comparison PDF in Notes Library, check the DAA tag',
        },
      ];
      await Message.insertMany(initialMessages);
    }
  } catch (err) {
    console.warn('[Seeder warning]:', err.message);
  }
}

module.exports = seedInitialData;
