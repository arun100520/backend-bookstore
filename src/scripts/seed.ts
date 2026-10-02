import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables before doing anything else
dotenv.config({ path: resolve(process.cwd(), '.env') });

import Book from '../models/Book.js';
import Category from '../models/Category.js';
import Genre from '../models/Genre.js';
import Language from '../models/Language.js';
import { connectDB } from '../config/db.js';
import { requireDisposableDatabase } from '../config/operationalSafety.js';

const SAMPLE_COVERS = [
  'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&q=80&w=800',
  'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?auto=format&fit=crop&q=80&w=800',
];

async function seed() {
  try {
    requireDisposableDatabase();
    console.log('🌱 Starting database seed...');
    await connectDB();

    console.log('🗑️  Clearing existing catalog collections...');
    await Promise.all([
      Book.collection.drop().catch(() => {}),
      Category.collection.drop().catch(() => {}),
      Genre.collection.drop().catch(() => {}),
      Language.collection.drop().catch(() => {}),
    ]);
    
    // Give mongoose time to recreate indexes
    await Book.init();
    await Category.init();
    await Genre.init();
    await Language.init();

    console.log('📚 Inserting taxonomies...');
    const [catTech, catBusiness, catFiction] = await Category.insertMany([
      { name: 'Technology', slug: 'technology' },
      { name: 'Business & Economics', slug: 'business-economics' },
      { name: 'Science Fiction', slug: 'science-fiction' },
    ]);

    const [genWeb, genSys, genStartup, genSpace] = await Genre.insertMany([
      { name: 'Web Development', slug: 'web-development' },
      { name: 'Systems Programming', slug: 'systems-programming' },
      { name: 'Startups', slug: 'startups' },
      { name: 'Space Opera', slug: 'space-opera' },
    ]);

    const [langEn, langEs] = await Language.insertMany([
      { name: 'English', slug: 'english' },
      { name: 'Spanish', slug: 'spanish' },
    ]);

    console.log('📖 Inserting books...');
    const books = [];
    for (let i = 1; i <= 15; i++) {
      let categoryId, genreId, langId;

      if (i <= 5) {
        categoryId = catTech._id;
        genreId = genWeb._id;
        langId = langEn._id;
      } else if (i <= 10) {
        categoryId = catBusiness._id;
        genreId = genStartup._id;
        langId = langEn._id;
      } else {
        categoryId = catFiction._id;
        genreId = genSpace._id;
        langId = langEs._id;
      }

      books.push({
        title: `Sample Book Title ${i}`,
        slug: `sample-book-title-${i}`,
        authors: [`Author ${i}`, `Co-author ${i}`],
        description: `This is a comprehensive description for Sample Book ${i}. It covers everything you need to know about the topic. Fully detailed and highly engaging.`,
        priceInPaise: Math.floor(Math.random() * 200000) + 50000, // ₹500 to ₹2500
        coverUrl: SAMPLE_COVERS[i % SAMPLE_COVERS.length],
        pdfUrl: 'https://res.cloudinary.com/demo/raw/upload/sample.pdf', // dummy pdf
        categoryIds: [categoryId],
        genreIds: [genreId],
        language: langId,
        isActive: true,
        isbn: `978-0-123456-47-${i}`,
        ratingAvg: Number((Math.random() * 2 + 3).toFixed(1)), // 3.0 to 5.0
      });
    }

    await Book.insertMany(books);
    console.log('✅ Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seed();
