import { Request, Response, NextFunction } from 'express';
import Book from '../models/Book.js';
import { AppError } from '../middleware/errorHandler.js';
import { uploadCoverImage, uploadPdf } from '../services/cloudinaryService.js';

export async function createBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.create(req.body);
    res.status(201).json({ book });
  } catch (err) {
    next(err);
  }
}

export async function updateBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!book) {
      throw new AppError(404, 'Book not found');
    }
    res.status(200).json({ book });
  } catch (err) {
    next(err);
  }
}

export async function deleteBook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);
    if (!book) {
      throw new AppError(404, 'Book not found');
    }
    res.status(200).json({ message: 'Book deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function uploadBookFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bookId = req.params.id;
    const book = await Book.findById(bookId);

    if (!book) {
      throw new AppError(404, 'Book not found');
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files || (!files['cover'] && !files['pdf'])) {
      throw new AppError(400, 'No files provided');
    }

    let coverUrl = book.coverUrl;
    let pdfUrl = book.pdfUrl;

    if (files['cover'] && files['cover'].length > 0) {
      const coverResult = await uploadCoverImage(files['cover'][0].buffer, `book-${bookId}-cover`);
      coverUrl = coverResult.url;
    }

    if (files['pdf'] && files['pdf'].length > 0) {
      const pdfResult = await uploadPdf(files['pdf'][0].buffer, `book-${bookId}-pdf`);
      pdfUrl = pdfResult.url;
    }

    book.coverUrl = coverUrl;
    book.pdfUrl = pdfUrl;
    await book.save();

    res.status(200).json({ message: 'Files uploaded successfully', book });
  } catch (err) {
    next(err);
  }
}
