import { Request, Response, NextFunction } from 'express';
import { Model, Document } from 'mongoose';
import { AppError } from '../middleware/errorHandler.js';

import Category from '../models/Category.js';
import Genre from '../models/Genre.js';
import Language from '../models/Language.js';

// ── Generic Taxonomy Handlers ──────────────────────────────────────────────────

function createTaxonomy<T extends Document>(ModelClass: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const doc = await ModelClass.create(req.body);
      res.status(201).json({ data: doc });
    } catch (err) {
      next(err);
    }
  };
}

function updateTaxonomy<T extends Document>(ModelClass: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const doc = await ModelClass.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!doc) {
        throw new AppError(404, `${ModelClass.modelName} not found`);
      }
      res.status(200).json({ data: doc });
    } catch (err) {
      next(err);
    }
  };
}

function deleteTaxonomy<T extends Document>(ModelClass: Model<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const doc = await ModelClass.findByIdAndDelete(req.params.id);
      if (!doc) {
        throw new AppError(404, `${ModelClass.modelName} not found`);
      }
      res.status(200).json({ message: `${ModelClass.modelName} deleted successfully` });
    } catch (err) {
      next(err);
    }
  };
}

// ── Category ──────────────────────────────────────────────────────────────────
export const createCategory = createTaxonomy(Category);
export const updateCategory = updateTaxonomy(Category);
export const deleteCategory = deleteTaxonomy(Category);

// ── Genre ─────────────────────────────────────────────────────────────────────
export const createGenre = createTaxonomy(Genre);
export const updateGenre = updateTaxonomy(Genre);
export const deleteGenre = deleteTaxonomy(Genre);

// ── Language ──────────────────────────────────────────────────────────────────
export const createLanguage = createTaxonomy(Language);
export const updateLanguage = updateTaxonomy(Language);
export const deleteLanguage = deleteTaxonomy(Language);
