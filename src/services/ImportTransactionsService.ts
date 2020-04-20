import { getRepository, getCustomRepository, In } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const categoriesRepository = getRepository(Category);
    const transactionsRepository = getCustomRepository(TransactionsRepository);

    //  le o arquivo CSV
    const contactsReadStream = fs.createReadStream(filePath);

    // instanciando o csvParse
    // comeca ler a partir da segunda linha
    const parsers = csvParse({
      from_line: 2,
      delimiter: ',',
    });

    // le linha por linha, conforme estiver disponivel
    const parseCSV = contactsReadStream.pipe(parsers);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    // Primeiro parametro: nome do evento
    // segundo Parametro: pra cada linha vamos estar desestruturando
    // line.map = cada celula definimos como uma string
    // cell.trim() para tirar o espaco
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      // validamos que tudo esteja correto
      if (!title || !type || !value) return;

      // Armazenamos localmente primeiro
      categories.push(category);

      // Armazenamos localmente primeiro
      transactions.push({ title, type, value, category });
    });

    // Isso vai verificar se o parseCSV emitiu um evento chamado 'end'
    await new Promise(resolve => parseCSV.on('end', resolve));

    // Utilizando o metodo In, Verificamos se as categorias recebidas existem no BD
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    // Fazemos um map para obter somente o titulo
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // Vai retornar todas as categorias que nao estiverem na existentCategoriesTitles.
    // Supondo que no existentCategoriesTitle so existe 'radical'. O includes vai devolver
    // todas as categorias diferentes a 'radical' existente no array categories
    // o segundo filter tira os duplicados
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    // criar todas as novas categorias
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    // salvar todas as novas categorias
    await categoriesRepository.save(newCategories);

    // unir as categorias novas com as categorias existentes
    const finalCategories = [...newCategories, ...existentCategories];

    // criar todas as transacoes
    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    // salvar todas as transacoes de uma vez
    await transactionsRepository.save(createdTransactions);

    // excluir arquivo
    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
