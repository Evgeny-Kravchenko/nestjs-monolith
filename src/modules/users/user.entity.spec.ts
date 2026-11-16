import { getMetadataArgsStorage } from 'typeorm';

import { User } from './user.entity';
import { UserStatus } from './user-status.enum';

describe('User entity', () => {
  const storage = getMetadataArgsStorage();

  const column = (propertyName: string) => {
    const found = storage
      .filterColumns(User)
      .find((c) => c.propertyName === propertyName);
    if (!found) {
      throw new Error(`Column for property ${propertyName} not found`);
    }
    return found;
  };

  it('should map to the users table', () => {
    const table = storage.tables.find((t) => t.target === User);

    expect(table?.name).toBe('users');
  });

  it('should use a generated uuid primary key', () => {
    const generation = storage.generations.find(
      (g) => g.target === User && g.propertyName === 'id',
    );

    expect(column('id').options.primary).toBe(true);
    expect(generation?.strategy).toBe('uuid');
  });

  it('should store email as varchar(254) with the UQ_users_email unique index', () => {
    const index = storage
      .filterIndices(User)
      .find((i) => i.name === 'UQ_users_email');

    expect(column('email').options).toMatchObject({
      type: 'varchar',
      length: 254,
    });
    expect(index?.unique).toBe(true);
    expect(index?.columns).toEqual(['email']);
  });

  it('should store the password hash in password_hash and never select it by default', () => {
    expect(column('passwordHash').options).toMatchObject({
      name: 'password_hash',
      type: 'varchar',
      length: 255,
      select: false,
    });
  });

  it('should store status as the users_status_enum enum', () => {
    expect(column('status').options).toMatchObject({
      type: 'enum',
      enum: UserStatus,
      enumName: 'users_status_enum',
    });
  });

  it('should keep created_at and updated_at as timestamptz', () => {
    expect(column('createdAt').mode).toBe('createDate');
    expect(column('createdAt').options).toMatchObject({
      name: 'created_at',
      type: 'timestamptz',
    });
    expect(column('updatedAt').mode).toBe('updateDate');
    expect(column('updatedAt').options).toMatchObject({
      name: 'updated_at',
      type: 'timestamptz',
    });
  });
});
