const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

class PostgresManager {
  constructor(appPath, isPackaged, runtimeDirOverride = null) {
    this.isPackaged = isPackaged;
    this.dbUser = 'postgres';
    this.dbPass = 'postgres';
    this.dbName = 'zs_offline';
    this.dbPort = '5444';

    // In production, expect the runtime folder alongside the exe
    // In dev, use the repo's portable/runtime or fallback to C:\zn\portable\runtime
    this.runtimeDir = runtimeDirOverride || (isPackaged 
      ? path.join(path.dirname(process.execPath), 'runtime')
      : (fs.existsSync(path.resolve(__dirname, '../../portable/runtime'))
          ? path.resolve(__dirname, '../../portable/runtime')
          : 'C:\\zn\\portable\\runtime'));
    
    this.postgresBinDir = path.join(this.runtimeDir, 'postgres', 'bin');
    this.postgresDataDir = path.join(this.runtimeDir, 'data');
    this.postgresLogsDir = path.join(this.runtimeDir, 'logs');
    
    this.pgProcess = null;
    this.authPath = path.join(this.postgresDataDir, '.postgres-auth.json');
    this.legacyAuthPath = path.join(this.runtimeDir, '.postgres-auth.json');
    this.pendingDbPass = null;
    const activeAuthPath = fs.existsSync(this.authPath)
      ? this.authPath
      : (fs.existsSync(this.legacyAuthPath) ? this.legacyAuthPath : null);
    if (activeAuthPath) {
      try {
        const auth = JSON.parse(fs.readFileSync(activeAuthPath, 'utf8'));
        if (!/^[a-f0-9]{48}$/.test(auth.password) && auth.password !== 'postgres') throw new Error('Invalid PostgreSQL credential file');
        this.dbPass = auth.password;
        if (auth.pendingPassword && /^[a-f0-9]{48}$/.test(auth.pendingPassword)) {
          this.pendingDbPass = auth.pendingPassword;
        }
      } catch (error) {
        throw new Error('PostgreSQL credentials corrupted. Recover the credential file from a backup: ' + error.message);
      }
    }
  }

  saveDatabaseCredentials(data) {
    fs.mkdirSync(path.dirname(this.authPath), { recursive: true });
    const temporary = this.authPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'w' });
    fs.renameSync(temporary, this.authPath);
  }

  ensureDirectories() {
    if (!fs.existsSync(this.postgresDataDir)) {
      fs.mkdirSync(this.postgresDataDir, { recursive: true });
    }
    if (!fs.existsSync(this.postgresLogsDir)) {
      fs.mkdirSync(this.postgresLogsDir, { recursive: true });
    }
    this.cleanupOldLogs();
  }

  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.postgresLogsDir);
      const now = Date.now();
      // Retention: Minimum 90 days (3 months), or if file has been marked as uploaded/synced
      const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const isLog = file.endsWith('.log') || file.endsWith('.log.gz');
        const isSyncedOrUploaded = file.includes('.synced') || file.includes('.uploaded');
        if (isLog || isSyncedOrUploaded) {
          const filePath = path.join(this.postgresLogsDir, file);
          const stats = fs.statSync(filePath);
          if (isSyncedOrUploaded || (now - stats.mtimeMs > RETENTION_MS)) {
            try {
              fs.unlinkSync(filePath);
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('Failed to cleanup old logs:', err);
    }
  }

  isInitialized() {
    return fs.existsSync(path.join(this.postgresDataDir, 'PG_VERSION'));
  }

  initializeDatabase() {
    return new Promise((resolve, reject) => {
      console.log('Initializing PostgreSQL data directory (first run).');
      // New customer installations must never use the shared default 'postgres' password.
      // Keep data/ empty until initdb succeeds, then persist data/.postgres-auth.json inside data/.
      if (!fs.existsSync(this.authPath)) {
        this.dbPass = crypto.randomBytes(24).toString('hex');
        this.pendingDbPass = null;
      }
      const passwordFile = path.join(this.runtimeDir, 'postgres.pw');
      fs.writeFileSync(passwordFile, this.dbPass, { encoding: 'utf8', mode: 0o600 });

      const initDbExe = path.join(this.postgresBinDir, 'initdb.exe');
      
      const args = [
        '-D', this.postgresDataDir,
        '-U', this.dbUser,
        '-A', 'scram-sha-256',
        `--pwfile=${passwordFile}`,
        '--encoding=UTF8'
      ];

      const initProcess = spawn(initDbExe, args);

      initProcess.stdout.on('data', data => console.log(`initdb: ${data}`));
      initProcess.stderr.on('data', data => console.error(`initdb err: ${data}`));

      let settled = false;
      const cleanupPasswordFile = () => {
        if (fs.existsSync(passwordFile)) {
          fs.unlinkSync(passwordFile);
        }
      };

      initProcess.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanupPasswordFile();
        reject(err);
      });

      initProcess.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanupPasswordFile();
        if (code === 0) {
          try {
            if (!fs.existsSync(this.authPath)) {
              this.saveDatabaseCredentials({ password: this.dbPass });
            }
            if (fs.existsSync(this.legacyAuthPath)) {
              try { fs.unlinkSync(this.legacyAuthPath); } catch {}
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`initdb failed with exit code ${code}`));
        }
      });
    });
  }

  startServer() {
    return new Promise((resolve, reject) => {
      console.log('Starting PostgreSQL runtime.');
      
      const pgCtlExe = path.join(this.postgresBinDir, 'pg_ctl.exe');
      const logFile = path.join(this.postgresLogsDir, 'postgresql.log');
      
      const args = [
        '-D', this.postgresDataDir,
        '-l', logFile,
        '-o', `-p ${this.dbPort} -h 127.0.0.1`,
        'start'
      ];

      try {
        execSync(`"${pgCtlExe}" -D "${this.postgresDataDir}" -l "${logFile}" -o "-p ${this.dbPort} -h 127.0.0.1" start`, { stdio: 'ignore' });
        resolve();
      } catch (err) {
        console.log(`pg_ctl start returned an error (might already be running). Err: ${err.message}`);
        resolve(); // resolve anyway to proceed to waitForReady
      }
    });
  }

  async waitForReady(retries = 60) {
    console.log('Waiting for PostgreSQL to accept connections...');
    const psqlExe = path.join(this.postgresBinDir, 'psql.exe');
    
    const checkPort = () => new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(300);
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(false);
      });
      sock.once('timeout', () => {
        sock.destroy();
        resolve(false);
      });
      sock.connect(Number(this.dbPort), '127.0.0.1');
    });

    for (let i = 0; i < retries; i++) {
      const portOpen = await checkPort();
      if (portOpen) {
        try {
          for (const password of [this.dbPass, this.pendingDbPass].filter(Boolean)) {
            try {
              const actualDataDir = execSync(`"${psqlExe}" -h 127.0.0.1 -p ${this.dbPort} -U ${this.dbUser} -d postgres -tAc "SHOW data_directory;"`, {
                env: { ...process.env, PGPASSWORD: password },
                encoding: 'utf8',
                timeout: 1500
              }).trim();
              // The port may belong to an unrelated database; never connect to or stop it.
              if (path.resolve(actualDataDir).toLowerCase() !== path.resolve(this.postgresDataDir).toLowerCase()) {
                throw new Error('Port 5444 belongs to a different PostgreSQL cluster');
              }
              if (password !== this.dbPass) {
                this.dbPass = password;
                this.saveDatabaseCredentials({ password });
                this.pendingDbPass = null;
              }
              console.log('Bundled PostgreSQL data directory verified and ready.');
              return true;
            } catch (error) {
              if (String(error.message).includes('different PostgreSQL cluster')) throw error;
            }
          }
        } catch (err) {
          // Port is open but server is still initializing
        }
      }
      await new Promise(res => setTimeout(res, 100));
    }
    throw new Error('PostgreSQL did not become ready in time.');
  }

  ensureDatabaseExists() {
    return new Promise((resolve, reject) => {
      const psqlExe = path.join(this.postgresBinDir, 'psql.exe');
      const createdbExe = path.join(this.postgresBinDir, 'createdb.exe');
      
      const flagFile = path.join(this.postgresDataDir, 'db_created.flag');
      if (fs.existsSync(flagFile)) {
        return resolve();
      }

      try {
        // Check if database exists
        const checkCmd = `"${psqlExe}" -h 127.0.0.1 -p ${this.dbPort} -U ${this.dbUser} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${this.dbName}';"`;
        const exists = execSync(checkCmd, { env: { ...process.env, PGPASSWORD: this.dbPass } }).toString().trim();
        
        if (exists !== '1') {
          console.log(`Creating database '${this.dbName}' with UTF8 encoding.`);
          execSync(`"${createdbExe}" -h 127.0.0.1 -p ${this.dbPort} -U ${this.dbUser} -E UTF8 -T template0 ${this.dbName}`, {
            env: { ...process.env, PGPASSWORD: this.dbPass },
            stdio: 'inherit'
          });
        }
        fs.writeFileSync(flagFile, 'ok', 'utf8');
        resolve();
      } catch (err) {
        reject(new Error(`Failed to ensure database exists: ${err.message}`));
      }
    });
  }

  async setupAndStart() {
    this.ensureDirectories();
    
    if (!this.isInitialized()) {
      await this.initializeDatabase();
    }
    
    this.applyPerformanceTuning();
    await this.startServer();
    await this.waitForReady();
    await this.ensureDatabaseExists();
    if (!fs.existsSync(this.authPath)) {
      if (fs.existsSync(this.legacyAuthPath)) {
        // Migrate legacy runtime/.postgres-auth.json into data/ so manual data/ folder swaps carry auth.
        const payload = { password: this.dbPass };
        if (this.pendingDbPass) payload.pendingPassword = this.pendingDbPass;
        this.saveDatabaseCredentials(payload);
        try { fs.unlinkSync(this.legacyAuthPath); } catch {}
      } else {
        this.rotateLegacyPassword();
      }
    }
    if (this.pendingDbPass) {
      this.rotateLegacyPassword();
    }
  }

  rotateLegacyPassword() {
    if (fs.existsSync(this.authPath) && !this.pendingDbPass) return;
    const nextPassword = this.pendingDbPass || crypto.randomBytes(24).toString('hex');
    // Crash-safe credential rotation: both old and candidate credentials remain available
    // until the database confirms ALTER ROLE, including after unexpected power loss.
    this.saveDatabaseCredentials({ password: this.dbPass, pendingPassword: nextPassword });
    const psqlExe = path.join(this.postgresBinDir, 'psql.exe');
    const sql = `ALTER ROLE postgres WITH PASSWORD '${nextPassword}';`;
    const result = spawnSync(psqlExe, ['-h', '127.0.0.1', '-p', this.dbPort,
      '-U', this.dbUser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      input: sql,
      env: { ...process.env, PGPASSWORD: this.dbPass },
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if (result.status !== 0) {
      throw new Error('Failed to rotate legacy PostgreSQL password: ' + (result.stderr || result.error?.message || result.status));
    }
    this.dbPass = nextPassword;
    this.pendingDbPass = null;
    this.saveDatabaseCredentials({ password: nextPassword });
  }

  /**
   * Writes optimized PostgreSQL performance settings to postgresql.auto.conf.
   * These override the defaults in postgresql.conf and are tuned for desktop/SSD usage.
   * Safe to call on every startup - file is idempotent.
   */
  applyPerformanceTuning() {
    const autoConfPath = path.join(this.postgresDataDir, 'postgresql.auto.conf');
    const marker = '# --- ZSystems Performance Tuning ---';

    try {
      let currentContent = '';
      if (fs.existsSync(autoConfPath)) {
        currentContent = fs.readFileSync(autoConfPath, 'utf8');
      }

      // If our tuning block already exists, skip
      if (currentContent.includes(marker)) {
        console.log('[PostgresManager] Performance tuning already applied.');
        return;
      }

      const tuningBlock = [
        '',
        marker,
        "# Optimized for desktop/portable use on SSD/NVMe drives",
        "random_page_cost = 1.1",
        "effective_cache_size = '512MB'",
        "work_mem = '16MB'",
        "maintenance_work_mem = '128MB'",
        "checkpoint_completion_target = 0.9",
        "max_wal_size = '256MB'",
        "# Aggressive autovacuum for tables with frequent updates",
        "autovacuum_vacuum_scale_factor = 0.05",
        "autovacuum_analyze_scale_factor = 0.02",
        "autovacuum_vacuum_cost_delay = '0'",
        marker + ' END',
        '',
      ].join('\n');

      fs.appendFileSync(autoConfPath, tuningBlock, 'utf8');
      console.log('[PostgresManager] Applied PostgreSQL performance tuning to postgresql.auto.conf.');
    } catch (err) {
      console.error('[PostgresManager] Failed to apply performance tuning:', err.message);
    }
  }

  stopServer() {
    console.log('Stopping PostgreSQL runtime.');
    const pgCtlExe = path.join(this.postgresBinDir, 'pg_ctl.exe');
    try {
      execSync(`"${pgCtlExe}" -D "${this.postgresDataDir}" stop -m fast`);
    } catch (err) {
      console.error('Failed to stop postgres properly:', err.message);
    }
  }

  getEnvironmentVariables() {
    return {
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: this.dbPort,
      DATABASE_USER: this.dbUser,
      DATABASE_PASSWORD: this.dbPass,
      DATABASE_NAME: this.dbName,
      DATABASE_URL: `postgresql://${this.dbUser}:${this.dbPass}@127.0.0.1:${this.dbPort}/${this.dbName}?schema=public`
    };
  }
}

module.exports = PostgresManager;
