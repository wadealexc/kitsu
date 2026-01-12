import { db } from './client.js';
import { users, chats, folders, tags } from './schema.js';
import { eq } from 'drizzle-orm';

console.log('Testing database operations...\n');

try {
  // 1. Create a test user
  console.log('1. Creating test user...');
  const [testUser] = await db.insert(users).values({
    email: 'test@example.com',
    name: 'Test User',
    password_hash: '$2a$10$dummyhash', // Dummy bcrypt hash
    role: 'admin',
    settings: { ui: { theme: 'dark' } },
    info: { test: true },
  }).returning();

  if (!testUser) throw new Error(`testUser not created`);

  console.log(`   ✓ Created user: ${testUser.name} (${testUser.id})`);

  // 2. Create a folder
  console.log('\n2. Creating test folder...');
  const [testFolder] = await db.insert(folders).values({
    user_id: testUser.id,
    name: 'My Projects',
  }).returning();

  if (!testFolder) throw new Error(`testFolder not created`);

  console.log(`   ✓ Created folder: ${testFolder.name} (${testFolder.id})`);

  // 3. Create a chat
  console.log('\n3. Creating test chat...');
  const [testChat] = await db.insert(chats).values({
    user_id: testUser.id,
    title: 'Test Conversation',
    folder_id: testFolder.id,
    messages: {
      messages: [
        { role: 'user', content: 'Hello!', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ],
    },
    metadata: {
      tags: ['test'],
      model: 'qwen3-vl-30b',
    },
  }).returning();

  if (!testChat) throw new Error(`testChat not created`);

  console.log(`   ✓ Created chat: ${testChat.title} (${testChat.id})`);
  console.log(`   ✓ Messages: ${testChat.messages.messages?.length || 0}`);
  console.log(`   ✓ Folder: ${testChat.folder_id}`);

  // 4. Create a tag
  console.log('\n4. Creating test tag...');
  const [testTag] = await db.insert(tags).values({
    name: 'important',
  }).returning();

  if (!testTag) throw new Error(`testTag not created`);

  console.log(`   ✓ Created tag: ${testTag.name} (${testTag.id})`);

  // 5. Query chats by user
  console.log('\n5. Querying chats by user...');
  const userChats = await db.select()
    .from(chats)
    .where(eq(chats.user_id, testUser.id));

  console.log(`   ✓ Found ${userChats.length} chat(s) for ${testUser.name}`);

  // 6. Query with relations
  console.log('\n6. Testing relations query...');
  const userWithChats = await db.query.users.findFirst({
    where: eq(users.id, testUser.id),
    with: {
      chats: true,
      folders: true,
    },
  });

  console.log(`   ✓ User: ${userWithChats?.name}`);
  console.log(`   ✓ Chats: ${userWithChats?.chats.length}`);
  console.log(`   ✓ Folders: ${userWithChats?.folders.length}`);

  // 7. Verify snake_case fields
  console.log('\n7. Verifying snake_case field names...');
  console.log(`   ✓ user.created_at: ${testUser.created_at} (Unix timestamp)`);
  console.log(`   ✓ chat.user_id: ${testChat.user_id}`);
  console.log(`   ✓ chat.folder_id: ${testChat.folder_id}`);
  console.log(`   ✓ folder.user_id: ${testFolder.user_id}`);

  // Clean up
  console.log('\n8. Cleaning up test data...');
  await db.delete(chats).where(eq(chats.id, testChat.id));
  await db.delete(folders).where(eq(folders.id, testFolder.id));
  await db.delete(tags).where(eq(tags.id, testTag.id));
  await db.delete(users).where(eq(users.id, testUser.id));

  console.log('   ✓ Test data cleaned up');

  console.log('\n✅ All database tests passed!');
  console.log('\n📝 Schema now matches OpenWebUI with intentional deviations:');
  console.log('   - chat.messages (not chat.chat) - clearer naming');
  console.log('   - chat.metadata (not chat.meta) - clearer naming');
  console.log('   - API responses will transform these fields for frontend compatibility');

} catch (error) {
  console.error('\n❌ Database test failed:');
  console.error(error);
  process.exit(1);
}
