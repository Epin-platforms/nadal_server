import pool from '../../config/database.js';

export async function getAccounts(req, res) {
    try{
        const {uid} = req.user;

        const q = `
            SELECT * FROM account
            WHERE uid = ?
        `;

        const [rows] = await pool.query(q, [uid]);

        res.json(rows);
    }catch(error){
        console.log(error);
        res.status(500).send();
    }
}

export async function getAccount(req, res) {
    try{
        const {uid} = req.user;
        const accountId = Number(req.params.accountId);

        const q = `
            SELECT * FROM account
            WHERE uid = ? AND accountId = ?
        `;

        const [rows] = await pool.query(q, [uid, accountId]);

        res.json(rows[0]);
    }catch(error){
        console.log(error);
        res.status(500).send();
    }
}


export async function createAccount(req, res) {
    try {
        const {uid} = req.user;
        const account = req.body;

        const q = `
            INSERT INTO account (uid, bank, account, accountName, accountTitle)
            VALUES (?,?,?,?,?)
        `;

        await pool.query(q, [uid, account.bank, account.account, account.accountName, account.accountTitle]);

        res.send();
    } catch (error) {
        console.log(error);
        res.status(500).send();
    }
}


export async function updateAccount(req, res) {
    try {
        const { uid } = req.user;
        const { bank, accountName, accountTitle, accountId } = req.body;
        
        const setParts = [];
        const values = [];

        if(bank != null){
            setParts.push("bank = ?");
            values.push(bank);
        }
        
        if (accountName != null) {
            setParts.push("accountName = ?");
            values.push(accountName);
        }

        if (accountTitle != null) {
            setParts.push("accountTitle = ?");
            values.push(accountTitle);
        }

        if (setParts.length === 0) {
            return res.status(400).send("No fields to update.");
        }

        values.push(uid, accountId);

        const q = `
            UPDATE account
            SET ${setParts.join(', ')}
            WHERE uid = ? AND accountId = ?
        `;

        await pool.query(q, values);
        res.send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}

export async function delteAccount(req, res) {
    try {
        const {uid} = req.user;
        const accountId = Number(req.query.accountId);

        const q = `
            DELETE FROM account
            WHERE accountId = ? AND uid = ?;
        `;

        await pool.query(q, [accountId, uid]);
        
        res.send()
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
}