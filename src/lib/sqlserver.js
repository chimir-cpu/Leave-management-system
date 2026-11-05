// src/lib/sqlserver.js
import sql from "mssql";

let pool = null;

export async function getSQLServerConnection() {
  // Prevent any SQL Server connection during local testing
  if (process.env.DISABLE_BIOMETRIC === "true") {
    throw new Error("Biometric SQL Server integration is disabled");
  }

  if (!pool) {
    const config = {
      server: process.env.SQL_SERVER_HOST,
      port: parseInt(process.env.SQL_SERVER_PORT || "1433"),
      user: process.env.SQL_SERVER_USER,
      password: process.env.SQL_SERVER_PASSWORD,
      database: process.env.SQL_SERVER_DATABASE,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
    };

    pool = await sql.connect(config);
  }

  return pool;
}

export async function querySQL(sqlQuery, params = []) {
  const pool = await getSQLServerConnection();
  const request = pool.request();

  params.forEach((param, index) => {
    request.input(`param${index}`, param);
  });

  const result = await request.query(sqlQuery);
  return result.recordset;
}