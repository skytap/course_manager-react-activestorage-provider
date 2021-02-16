/**
 * @noflow
 */

import Upload from './Upload'

jest.mock('activestorage', () => {
  return {
    DirectUpload: jest.fn(file => ({
      id: 'id',
      file,
      create(cb) {
        cb(null, { signed_id: 'signedId' })
      },
    })),
  }
})

const file = new File([], 'file')
const options = {
  onChangeFile: jest.fn(),
  onBeforeBlobRequest: jest.fn(),
  onBeforeStorageRequest: jest.fn(),
}

describe('Upload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    it('falls back to default options', () => {
      const upload = new Upload(file, {
        ...options,
        directUploadsPath: undefined,
      })
      expect(upload.options.directUploadsPath).toEqual(
        Upload.CONVENTIONAL_DIRECT_UPLOADS_PATH
      )
    })

    it('reports that it is waiting to upload', () => {
      new Upload(file, options) // eslint-disable-line no-new

      expect(options.onChangeFile).toHaveBeenCalledWith({
        id: { state: 'waiting', id: 'id', file },
      })
    })
  })

  describe('directUploadsUrl', () => {
    it('uses the conventional direct upload url by default', () => {
      const upload = new Upload(file, options)
      expect(upload.directUploadsUrl).toEqual(
        '/rails/active_storage/direct_uploads'
      )
    })

    test.each`
      protocol     | host         | port         | url
      ${'http'}    | ${'0.0.0.0'} | ${3000}      | ${'http://0.0.0.0:3000/rails/active_storage/direct_uploads'}
      ${'http'}    | ${'0.0.0.0'} | ${undefined} | ${'http://0.0.0.0/rails/active_storage/direct_uploads'}
      ${'http://'} | ${'0.0.0.0'} | ${undefined} | ${'http://0.0.0.0/rails/active_storage/direct_uploads'}
      ${undefined} | ${'0.0.0.0'} | ${3000}      | ${'//0.0.0.0:3000/rails/active_storage/direct_uploads'}
      ${undefined} | ${'0.0.0.0'} | ${undefined} | ${'//0.0.0.0/rails/active_storage/direct_uploads'}
    `(
      'allows the consumer to specify a different origin { protocol: $protocol, host: $host, port: $port}',
      ({ protocol, host, port, url }) => {
        const origin = { protocol, host, port }
        const upload = new Upload(file, { ...options, origin })
        expect(upload.directUploadsUrl).toEqual(url)
      }
    )
  })

  describe('start()', () => {
    it('resolves with the signed id from the direct upload', async () => {
      const upload = new Upload(file, options)
      expect(await upload.start()).toEqual('signedId')
    })

    it('reports that the upload is finished if it does so', async () => {
      const upload = new Upload(file, options)
      await upload.start()
      expect(options.onChangeFile).toHaveBeenCalledWith({
        id: { state: 'finished', id: 'id', file },
      })
    })

    describe('if the upload fails', () => {
      jest.resetModules().doMock('activestorage', () => {
        return {
          DirectUpload: jest.fn(file => ({
            id: 'id',
            file,
            create(cb) {
              cb('Failed') // eslint-disable-line standard/no-callback-literal
            },
          })),
        }
      })

      const Upload = require('./Upload').default

      it('rejects with the error', async () => {
        const upload = new Upload(file, options)
        let error = await upload.start()
        expect(error.message).toEqual('Failed')
      })

      it('reports an error', async () => {
        const upload = new Upload(file, options)
        await upload.start().catch(() => {})
        expect(options.onChangeFile).toHaveBeenCalledWith({
          id: { state: 'error', id: 'id', file, error: new Error('Failed') },
        })
      })
    })

    describe('if the resouce is locked', () => {
      jest.resetModules().doMock('activestorage', () => {
        return {
          DirectUpload: jest.fn(file => ({
            id: 'id',
            file,
            create(cb) {
              if(this.secondTime == null) {
                this.secondTime = true
                cb('Error storing "file.txt". Status: 423') // eslint-disable-line standard/no-callback-literal
              } else {
                cb(null, { signed_id: 'signedId' })
              }
            },
          })),
        }
      })
      const Upload = require('./Upload').default

      it('retries the error', async () => {
        const upload = new Upload(file, options)
        expect(await upload.start()).toEqual('signedId')
      })
    })

    describe('if the resouce is rate limited', () => {
      jest.resetModules().doMock('activestorage', () => {
        return {
          DirectUpload: jest.fn(file => ({
            id: 'id',
            file,
            create(cb) {
              if(this.secondTime == null) {
                this.secondTime = true
                cb('Error storing "file.txt". Status: 429') // eslint-disable-line standard/no-callback-literal
              } else {
                cb(null, { signed_id: 'signedId' })
              }
            },
          })),
        }
      })
      const Upload = require('./Upload').default

      it('retries the error', async () => {
        jest.useFakeTimers();
        const upload = new Upload(file, options)
        let promise = upload.start()
        expect(setTimeout).toHaveBeenCalledTimes(1);
        expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10000);
        jest.runAllTimers();
        expect(await promise).toEqual('signedId')
      })
    })

    describe('resource is too large', () => {
      jest.resetModules().doMock('activestorage', () => {
        return {
          DirectUpload: jest.fn(file => ({
            id: 'id',
            file,
            create(cb) {
              cb('Error storing "file.txt". Status: 413') // eslint-disable-line standard/no-callback-literal
            },
          })),
        }
      })
      const Upload = require('./Upload').default

      it('retries the error', async () => {
        const upload = new Upload(file, options)
        let error = await upload.start()
        expect(error.message).toEqual("Error storing \"file.txt\". This file's size (0MB) would exceed your account's storage quota.")
      })
    })
  })

  describe('as a direct upload delegate', () => {
    describe('directUploadWillCreateBlobWithXHR', () => {
      it('calls options.onBeforeBlobRequest', () => {
        const xhr = new XMLHttpRequest()
        const upload = new Upload(file, options)
        upload.directUploadWillCreateBlobWithXHR(xhr)
        expect(options.onBeforeBlobRequest).toHaveBeenCalledWith({
          id: 'id',
          file,
          xhr,
        })
      })

      describe('if headers are provided', () => {
        const mockXHR = {
          setRequestHeader: jest.fn(),
          readyState: 1,
        }
        window.XMLHttpRequest = jest.fn(() => mockXHR)

        it('adds the headers to the xhr request', () => {
          const xhr = new XMLHttpRequest()
          const headerKey = 'Test-Header'
          const headerValue = 'testValue'
          const headers = { [headerKey]: headerValue }
          const upload = new Upload(file, { headers, ...options })
          upload.directUploadWillCreateBlobWithXHR(xhr)
          expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
            headerKey,
            headerValue
          )
        })
      })
    })

    describe('directUploadWillStoreFileWithXHR', () => {
      it('calls options.onBeforeStorageRequest', () => {
        const xhr = { upload: { addEventListener: jest.fn() } }
        const upload = new Upload(file, options)
        upload.directUploadWillStoreFileWithXHR(xhr)
        expect(options.onBeforeStorageRequest).toHaveBeenCalledWith({
          id: 'id',
          file,
          xhr,
        })
      })

      it('listens for progress', () => {
        const xhr = { upload: { addEventListener: jest.fn() } }
        const upload = new Upload(file, options)
        upload.directUploadWillStoreFileWithXHR(xhr)
        expect(xhr.upload.addEventListener).toHaveBeenCalledWith(
          'progress',
          upload.handleProgress
        )
      })
    })

    describe('handleProgress', () => {
      it('reports uploading with the progress', () => {
        const upload = new Upload(file, options)
        upload.handleProgress({ loaded: 20, total: 100 })
        expect(options.onChangeFile).toHaveBeenCalledWith({
          id: {
            id: 'id',
            state: 'uploading',
            file,
            progress: 20,
          },
        })
      })
    })
  })
})
