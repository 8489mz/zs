import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import { Database } from '../database.types';

@Injectable()
export class TransactionHelper {
  async runInTransaction<T>(db: Kysely<Database>, work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return db.transaction().execute(async (trx) => work(trx));
  }
}
